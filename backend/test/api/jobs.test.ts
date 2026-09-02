import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindAudioJob,
  mockFindUserJobsPage,
  mockDeleteAudioJob,
  mockFindTranscripts,
  mockDeleteFilesFromBucket,
} = vi.hoisted(() => ({
  mockFindAudioJob: vi.fn(),
  mockFindUserJobsPage: vi.fn(),
  mockDeleteAudioJob: vi.fn(),
  mockFindTranscripts: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
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
}));

vi.mock("../../shared/data/transcripts.data", async (importActual) => ({
  ...(await importActual<
    typeof import("../../shared/data/transcripts.data")
  >()),
  findTranscripts: mockFindTranscripts,
}));

vi.mock("../../shared/ai/ai_transcribe_client", () => ({
  DEFAULT_TRANSCRIBE_MODEL: "nova-3",
  getTranscribeModelData: vi.fn(),
  isValidTranscribeModel: vi.fn(),
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
    mq: { queues, publish: vi.fn() },
  };
});

vi.mock("../../shared/bucket", () => ({
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
  createSignedUrls: vi.fn(),
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

vi.mock("../../shared/captionUploads", () => ({
  cleanupTerminalCaptionUpload: vi.fn(),
}));

import { createApp } from "../../api/app";
import { authedHeaders, sessionCookieHeader } from "../helpers/session";

const audioUploadId = "550e8400-e29b-41d4-a716-446655440000";

const audioJob = {
  audioUploadId,
  captionUploadId: null,
  fileName: "clip.mp3",
  source: "audio",
  youtubeSourceUrl: null,
  status: "completed",
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindAudioJob.mockResolvedValue(audioJob);
  mockFindTranscripts.mockResolvedValue(new Map());
  mockDeleteAudioJob.mockResolvedValue(undefined);
  mockDeleteFilesFromBucket.mockResolvedValue(undefined);
});

describe("GET /jobs/summarize/:audioUploadId", () => {
  it("is gone — summarization is a chat prompt now", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/summarize/${audioUploadId}`, {
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /jobs/transcribe/:audioUploadId", () => {
  it("returns an audio job for the owner", async () => {
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      status: "processing",
    });

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      audioUploadId,
      fileName: "clip.mp3",
      source: "audio",
      status: "processing",
      transcript: null,
      error: null,
    });
  });

  it("returns the transcript once the job has completed", async () => {
    mockFindAudioJob.mockResolvedValueOnce(audioJob);
    mockFindTranscripts.mockResolvedValueOnce(
      new Map([[audioUploadId, "the full transcript text"]]),
    );

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      audioUploadId,
      fileName: "clip.mp3",
      source: "audio",
      status: "completed",
      transcript: "the full transcript text",
      error: null,
    });
    expect(mockFindTranscripts).toHaveBeenCalledWith("user_01OWNER", [
      audioUploadId,
    ]);
  });

  it("revalidates an unchanged completed transcript with an ETag", async () => {
    mockFindAudioJob.mockResolvedValue(audioJob);
    mockFindTranscripts.mockResolvedValue(
      new Map([[audioUploadId, "the full transcript text"]]),
    );
    const app = await createApp();
    const cookie = await sessionCookieHeader("user_01OWNER");
    const url = `http://localhost/jobs/transcribe/${audioUploadId}`;

    const first = await app.request(url, {
      headers: { Cookie: cookie },
    });
    const etag = first.headers.get("ETag");

    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();
    expect(first.headers.get("Cache-Control")).toBe("private, no-cache");

    const second = await app.request(url, {
      headers: { Cookie: cookie, "If-None-Match": etag as string },
    });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("reports no transcript while the job hasn't produced one", async () => {
    mockFindAudioJob.mockResolvedValueOnce({ ...audioJob, status: "queued" });
    mockFindTranscripts.mockResolvedValueOnce(new Map());

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { transcript: null }).transcript).toBeNull();
  });

  it("degrades to a null transcript when the transcript read fails", async () => {
    mockFindAudioJob.mockResolvedValueOnce(audioJob);
    mockFindTranscripts.mockRejectedValueOnce(new Error("db exploded"));

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      audioUploadId,
      fileName: "clip.mp3",
      source: "audio",
      status: "completed",
      transcript: null,
      error: null,
    });
  });

  it("returns 404 when no audio job exists for the user", async () => {
    mockFindAudioJob.mockResolvedValueOnce(null);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      headers: await authedHeaders("user_01OTHER"),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Job not found" });
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`);
    expect(res.status).toBe(401);
    expect(mockFindAudioJob).not.toHaveBeenCalled();
  });
});

describe("DELETE /jobs/transcribe/:audioUploadId", () => {
  it("removes the audio and caption objects before deleting the job", async () => {
    const captionUploadId = "650e8400-e29b-41d4-a716-446655440111";
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      captionUploadId,
    });

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      method: "DELETE",
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(res.headers.get("ETag")).toBeNull();
    expect(mockDeleteAudioJob).toHaveBeenCalledWith(
      "user_01OWNER",
      audioUploadId,
    );
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith("user_01OWNER", [
      audioUploadId,
      captionUploadId,
    ]);
  });

  it("scopes the delete to the requesting user", async () => {
    mockFindAudioJob.mockResolvedValueOnce(null);

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${audioUploadId}`, {
      method: "DELETE",
      headers: await authedHeaders("user_01INTRUDER"),
    });
    expect(res.status).toBe(200);
    expect(mockDeleteFilesFromBucket).not.toHaveBeenCalled();
    expect(mockDeleteAudioJob).not.toHaveBeenCalled();
  });
});

describe("removed transcript rerun routes", () => {
  it.each([
    `/jobs/transcribe/${audioUploadId}/rerun`,
    `/jobs/youtube/${audioUploadId}/rerun`,
  ])("returns 404 for POST %s", async (path) => {
    const response = await (
      await createApp()
    ).request(`http://localhost${path}`, {
      method: "POST",
      headers: await authedHeaders("user_01OWNER"),
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /jobs", () => {
  const jobRow = {
    audioUploadId: "550e8400-e29b-41d4-a716-44665544000a",
    fileName: "lecture.mp3",
    source: "audio",
    status: "completed",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    error: null,
  };

  it("returns the user's transcription jobs", async () => {
    mockFindUserJobsPage.mockResolvedValueOnce([jobRow]);
    const res = await (
      await createApp()
    ).request("http://localhost/jobs", {
      headers: await authedHeaders("user_01OWNER"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jobs: { audioUploadId: string }[];
      nextCursor: string | null;
    };
    expect(body.jobs.map((job) => job.audioUploadId)).toEqual([
      jobRow.audioUploadId,
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it("issues a cursor when the over-fetch shows another page", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...jobRow,
      audioUploadId: `550e8400-e29b-41d4-a716-4466554400${String(index).padStart(2, "0")}`,
    }));
    mockFindUserJobsPage.mockResolvedValueOnce(rows);
    const res = await (
      await createApp()
    ).request("http://localhost/jobs", {
      headers: await authedHeaders("user_01OWNER"),
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
