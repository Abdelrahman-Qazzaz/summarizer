import { describe, it, expect, vi, beforeEach } from "vitest";
const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockReadTextFile,
  mockDelete,
  mockDeleteFilesFromBucket,
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockReadTextFile: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: { select: mockSelect, delete: mockDelete },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", () => ({
  readTextFile: mockReadTextFile,
  deleteFileFromBucket: vi.fn(),
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
  createSignedUrls: vi.fn(),
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
const uploadId = "550e8400-e29b-41d4-a716-446655440000";
const transcriptUploadId = "660e8400-e29b-41d4-a716-446655440001";

describe("GET /jobs/summarize/:uploadId", () => {
  it("is gone — summarization is a chat prompt now", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/summarize/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /jobs/transcribe/:uploadId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });

  it("returns an audio job for the owner", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "processing",
        transcriptUploadId: null,
        error: null,
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uploadId,
      fileName: "clip.mp3",
      status: "processing",
      transcript: null,
      error: null,
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns the transcript once the job has completed", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "completed",
        transcriptUploadId,
        error: null,
      },
    ]);
    mockReadTextFile.mockResolvedValueOnce("the full transcript text");
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uploadId,
      fileName: "clip.mp3",
      status: "completed",
      transcript: "the full transcript text",
      error: null,
    });
    expect(mockReadTextFile).toHaveBeenCalledWith(
      "user_01OWNER",
      transcriptUploadId,
    );
  });

  it("reports no transcript rather than failing when the bucket read fails", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "completed",
        transcriptUploadId,
        error: null,
      },
    ]);
    mockReadTextFile.mockRejectedValueOnce(new Error("storage down"));
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { transcript: null }).transcript).toBeNull();
  });

  it("does not read a stale transcript while the job is not completed", async () => {
    // A re-run resets the row to "queued" while the previous transcript is
    // still in the bucket; it must not be read in that window.
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "queued",
        transcriptUploadId,
        error: null,
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { transcript: null }).transcript).toBeNull();
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });

  it("returns 404 when no audio job exists for the user", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OTHER") },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Job not found" });
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`);
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("DELETE /jobs/transcribe/:uploadId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockDelete.mockImplementation(() => ({
      where: () => Promise.resolve(),
    }));
    mockDeleteFilesFromBucket.mockResolvedValue(undefined);
  });

  it("also deletes the transcript file, which is keyed separately", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "completed",
        transcriptUploadId,
        error: null,
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      method: "DELETE",
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith("user_01OWNER", [
      uploadId,
      transcriptUploadId,
    ]);
  });

  it("deletes only the audio when the job never produced a transcript", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "failed",
        transcriptUploadId: null,
        error: "boom",
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      method: "DELETE",
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith("user_01OWNER", [
      uploadId,
    ]);
  });

  it("scopes bucket deletes to the requesting user", async () => {
    // Ownership is structural: the bucket key is <userId>/<uploadId>, so a
    // non-owner's delete resolves to a path that doesn't exist and no-ops.
    mockLimit.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      method: "DELETE",
      headers: { Cookie: await sessionCookieHeader("user_01INTRUDER") },
    });
    expect(res.status).toBe(200);
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith("user_01INTRUDER", [
      uploadId,
    ]);
  });
});

describe("GET /jobs", () => {
  const mockOrderBy = vi.fn();
  const audioRow = {
    uploadId: "550e8400-e29b-41d4-a716-44665544000a",
    fileName: "lecture.mp3",
    status: "completed",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockImplementation(() => ({ orderBy: mockOrderBy }));
    mockOrderBy.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });

  it("returns the user's transcription jobs", async () => {
    mockLimit.mockResolvedValueOnce([audioRow]);
    const res = await (
      await createApp()
    ).request("http://localhost/jobs", {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jobs: { uploadId: string }[];
      nextCursor: string | null;
    };
    expect(body.jobs.map((job) => job.uploadId)).toEqual([audioRow.uploadId]);
    expect(body.nextCursor).toBeNull();
    // One table now, so one query.
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("issues a cursor when the over-fetch shows another page", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...audioRow,
      uploadId: `550e8400-e29b-41d4-a716-4466554400${String(index).padStart(2, "0")}`,
    }));
    mockLimit.mockResolvedValueOnce(rows);
    const res = await (
      await createApp()
    ).request("http://localhost/jobs", {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jobs: unknown[];
      nextCursor: string | null;
    };
    expect(body.jobs).toHaveLength(20);
    expect(body.nextCursor).toBeTruthy();
  });
});
