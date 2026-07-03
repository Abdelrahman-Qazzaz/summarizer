import { describe, it, expect, vi, beforeEach } from "vitest";
const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockOrderBy,
  mockReadTextFile,
  mockDelete,
  mockDeleteFileFromBucket,
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockOrderBy: vi.fn(),
  mockReadTextFile: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteFileFromBucket: vi.fn(),
}));

vi.mock("../../shared/db", () => ({
  db: { select: mockSelect, delete: mockDelete },
  TextSummarizationJobs: { uploadId: "upload_id", userId: "user_id" },
  AudioTranscriptionJobs: { uploadId: "upload_id", userId: "user_id" },
  jobStatusEnum: { enumValues: ["queued", "processing", "completed", "failed"] },
}));

vi.mock("../../shared/bucket", () => ({
  readTextFile: mockReadTextFile,
  deleteFileFromBucket: mockDeleteFileFromBucket,
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
const uploadId = "550e8400-e29b-41d4-a716-446655440000";

describe("GET /jobs/summarize/:uploadId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });
  it("returns 401 without a session cookie", async () => {
    const res = await (await createApp()).request(
      `http://localhost/jobs/summarize/${uploadId}`,
    );
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
  it("returns a text job for the owner", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "notes.txt",
        status: "completed",
        summary: "A short summary.",
        error: null,
      },
    ]);
    const userId = "user_01OWNER";
    const res = await (await createApp()).request(
      `http://localhost/jobs/summarize/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader(userId) },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "text",
      uploadId,
      fileName: "notes.txt",
      status: "completed",
      summary: "A short summary.",
      error: null,
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
  it("returns 404 when no text job exists for the user", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await (await createApp()).request(
      `http://localhost/jobs/summarize/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader("user_01OTHER") },
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Job not found" });
    expect(mockSelect).toHaveBeenCalledTimes(1);
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
    mockLimit
      .mockResolvedValueOnce([
        {
          uploadId,
          fileName: "clip.mp3",
          status: "processing",
          error: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const userId = "user_01OWNER";
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader(userId) },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "audio",
      uploadId,
      fileName: "clip.mp3",
      status: "processing",
      transcript: null,
      summary: null,
      summaryStatus: null,
      error: null,
    });
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
  it("returns the transcript and summary once the child text job exists", async () => {
    mockLimit
      .mockResolvedValueOnce([
        { uploadId, fileName: "clip.mp3", status: "completed", error: null },
      ])
      .mockResolvedValueOnce([
        { uploadId: "child-text-id", status: "completed", summary: "A short summary." },
      ]);
    mockReadTextFile.mockResolvedValueOnce("the full transcript text");
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "audio",
      uploadId,
      fileName: "clip.mp3",
      status: "completed",
      transcript: "the full transcript text",
      summary: "A short summary.",
      summaryStatus: "completed",
      error: null,
    });
    expect(mockReadTextFile).toHaveBeenCalledWith("child-text-id");
  });
  it("surfaces summaryStatus when the downstream summary failed", async () => {
    mockLimit
      .mockResolvedValueOnce([
        { uploadId, fileName: "clip.mp3", status: "completed", error: null },
      ])
      .mockResolvedValueOnce([
        { uploadId: "child-text-id", status: "failed", summary: null },
      ]);
    mockReadTextFile.mockResolvedValueOnce("the full transcript text");
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "audio",
      uploadId,
      fileName: "clip.mp3",
      status: "completed",
      transcript: "the full transcript text",
      summary: null,
      summaryStatus: "failed",
      error: null,
    });
  });
  it("does not read a stale transcript while the audio job is not completed", async () => {
    // A re-run resets the audio row to "queued" while the previous child text
    // row/file still exist; the transcript must not be read in that window.
    mockLimit
      .mockResolvedValueOnce([
        { uploadId, fileName: "clip.mp3", status: "queued", error: null },
      ])
      .mockResolvedValueOnce([
        { uploadId: "child-text-id", status: "queued", summary: null },
      ]);
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "audio",
      uploadId,
      fileName: "clip.mp3",
      status: "queued",
      transcript: null,
      summary: null,
      summaryStatus: "queued",
      error: null,
    });
    expect(mockReadTextFile).not.toHaveBeenCalled();
  });
  it("returns 404 when no audio job exists for the user", async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        headers: { Cookie: await sessionCookieHeader("user_01OTHER") },
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Job not found" });
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

describe("DELETE /jobs/transcribe/:uploadId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockDelete.mockImplementation(() => ({ where: () => Promise.resolve() }));
    mockDeleteFileFromBucket.mockResolvedValue(undefined);
  });
  it("also deletes the orphaned child transcript file", async () => {
    mockLimit.mockResolvedValueOnce([{ uploadId: "child-text-id" }]);
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        method: "DELETE",
        headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
      },
    );
    expect(res.status).toBe(200);
    expect(mockDeleteFileFromBucket).toHaveBeenCalledWith(uploadId);
    expect(mockDeleteFileFromBucket).toHaveBeenCalledWith("child-text-id");
    expect(mockDeleteFileFromBucket).toHaveBeenCalledTimes(2);
  });
  it("deletes only the audio file when there is no child transcript", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}`,
      {
        method: "DELETE",
        headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
      },
    );
    expect(res.status).toBe(200);
    expect(mockDeleteFileFromBucket).toHaveBeenCalledWith(uploadId);
    expect(mockDeleteFileFromBucket).toHaveBeenCalledTimes(1);
  });
});
