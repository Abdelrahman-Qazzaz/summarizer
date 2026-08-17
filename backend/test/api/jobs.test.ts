import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindAudioJob,
  mockFindUserJobsPage,
  mockDeleteAudioJob,
  mockRequeueAudioJob,
  mockFindTranscripts,
  mockDeleteTranscript,
  mockDeleteFilesFromBucket,
  mockPublish,
  mockIsValidTranscribeModel,
} = vi.hoisted(() => ({
  mockFindAudioJob: vi.fn(),
  mockFindUserJobsPage: vi.fn(),
  mockDeleteAudioJob: vi.fn(),
  mockRequeueAudioJob: vi.fn(),
  mockFindTranscripts: vi.fn(),
  mockDeleteTranscript: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
  mockPublish: vi.fn(),
  mockIsValidTranscribeModel: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: {},
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/data/jobs.data", async (importActual) => ({
  ...(await importActual<typeof import("../../shared/data/jobs.data")>()),
  findAudioJob: mockFindAudioJob,
  findUserJobsPage: mockFindUserJobsPage,
  deleteAudioJob: mockDeleteAudioJob,
  requeueAudioJob: mockRequeueAudioJob,
}));

vi.mock("../../shared/data/transcripts.data", async (importActual) => ({
  ...(await importActual<
    typeof import("../../shared/data/transcripts.data")
  >()),
  findTranscripts: mockFindTranscripts,
  deleteTranscript: mockDeleteTranscript,
}));

vi.mock("../../shared/ai/ai_transcribe_client", () => ({
  DEFAULT_TRANSCRIBE_MODEL: "nova-3",
  getTranscribeModelData: vi.fn(),
  isValidTranscribeModel: mockIsValidTranscribeModel,
}));

vi.mock("../../shared/message-queue/messageQueue", () => {
  const queues = {
    TRANSCRIBE: "transcribe",
    TRANSCRIBE_DONE: "transcribe_done",
    YT_FETCH: "yt_fetch",
    YT_FETCH_FAILED: "yt_fetch_failed",
  } as const;

  return {
    QUEUES: queues,
    mq: { queues, publish: mockPublish },
  };
});

vi.mock("../../shared/bucket", () => ({
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
  createSignedUrls: vi.fn(),
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

import { createApp } from "../../api/app";
import { sessionCookieHeader } from "../helpers/session";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";

const audioJob = {
  uploadId,
  fileName: "clip.mp3",
  status: "completed",
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindTranscripts.mockResolvedValue(new Map());
  mockDeleteAudioJob.mockResolvedValue(undefined);
  mockRequeueAudioJob.mockResolvedValue({ uploadId });
  mockDeleteTranscript.mockResolvedValue(undefined);
  mockDeleteFilesFromBucket.mockResolvedValue(undefined);
  mockPublish.mockResolvedValue(undefined);
  mockIsValidTranscribeModel.mockResolvedValue(true);
});

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
  it("returns an audio job for the owner", async () => {
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      status: "processing",
    });

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
  });

  it("returns the transcript once the job has completed", async () => {
    mockFindAudioJob.mockResolvedValueOnce(audioJob);
    mockFindTranscripts.mockResolvedValueOnce(
      new Map([[uploadId, "the full transcript text"]]),
    );

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
    expect(mockFindTranscripts).toHaveBeenCalledWith("user_01OWNER", [
      uploadId,
    ]);
  });

  it("reports no transcript while the job hasn't produced one", async () => {
    // A re-run drops the row, so a job that isn't completed has no transcript.
    mockFindAudioJob.mockResolvedValueOnce({ ...audioJob, status: "queued" });
    mockFindTranscripts.mockResolvedValueOnce(new Map());

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { transcript: null }).transcript).toBeNull();
  });

  it("degrades to a null transcript when the transcript read fails", async () => {
    mockFindAudioJob.mockResolvedValueOnce(audioJob);
    mockFindTranscripts.mockRejectedValueOnce(new Error("db exploded"));

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
      transcript: null,
      error: null,
    });
  });

  it("returns 404 when no audio job exists for the user", async () => {
    mockFindAudioJob.mockResolvedValueOnce(null);
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
    expect(mockFindAudioJob).not.toHaveBeenCalled();
  });
});

describe("DELETE /jobs/transcribe/:uploadId", () => {
  it("removes the audio object; the transcript row cascades with the job", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      method: "DELETE",
      headers: { Cookie: await sessionCookieHeader("user_01OWNER") },
    });
    expect(res.status).toBe(200);
    expect(mockDeleteAudioJob).toHaveBeenCalledWith("user_01OWNER", uploadId);
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith("user_01OWNER", [
      uploadId,
    ]);
  });

  it("scopes the delete to the requesting user", async () => {
    // Ownership is structural: the bucket key is <userId>/<uploadId>, so a
    // non-owner's delete resolves to a path that doesn't exist and no-ops.
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

describe("POST /jobs/transcribe/:uploadId/rerun", () => {
  const request = async () =>
    (await createApp()).request(
      `http://localhost/jobs/transcribe/${uploadId}/rerun`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: await sessionCookieHeader("user_01OWNER"),
        },
        body: JSON.stringify({ transcriptModelId: "nova-3" }),
      },
    );

  it("requeues a terminal job and publishes a new delivery", async () => {
    const res = await request();

    expect(res.status).toBe(200);
    expect(mockRequeueAudioJob).toHaveBeenCalled();
    expect(mockDeleteTranscript).toHaveBeenCalledWith(uploadId);
    expect(mockPublish).toHaveBeenCalledWith("transcribe", { uploadId });
  });

  it("rejects rerunning a queued or processing job", async () => {
    mockRequeueAudioJob.mockResolvedValueOnce(null);
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      status: "processing",
    });

    const res = await request();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "Job is already queued or processing",
    });
    expect(mockDeleteTranscript).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("GET /jobs", () => {
  const jobRow = {
    uploadId: "550e8400-e29b-41d4-a716-44665544000a",
    fileName: "lecture.mp3",
    status: "completed",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    error: null,
  };

  it("returns the user's transcription jobs", async () => {
    mockFindUserJobsPage.mockResolvedValueOnce([jobRow]);
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
    expect(body.jobs.map((job) => job.uploadId)).toEqual([jobRow.uploadId]);
    expect(body.nextCursor).toBeNull();
  });

  it("issues a cursor when the over-fetch shows another page", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...jobRow,
      uploadId: `550e8400-e29b-41d4-a716-4466554400${String(index).padStart(2, "0")}`,
    }));
    mockFindUserJobsPage.mockResolvedValueOnce(rows);
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
