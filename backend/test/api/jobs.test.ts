import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindAudioJob,
  mockFindUserJobsPage,
  mockDeleteAudioJob,
  mockRequeueAudioJob,
  mockFindTranscripts,
  mockDeleteTranscript,
  mockDeleteFilesFromBucket,
  mockCleanupTerminalCaptionUpload,
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
  mockCleanupTerminalCaptionUpload: vi.fn(),
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

vi.mock("../../shared/captionUploads", () => ({
  cleanupTerminalCaptionUpload: mockCleanupTerminalCaptionUpload,
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
  mockRequeueAudioJob.mockResolvedValue({ audioUploadId });
  mockDeleteTranscript.mockResolvedValue(undefined);
  mockDeleteFilesFromBucket.mockResolvedValue(undefined);
  mockCleanupTerminalCaptionUpload.mockResolvedValue(false);
  mockPublish.mockResolvedValue(undefined);
  mockIsValidTranscribeModel.mockResolvedValue(true);
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
    // A re-run drops the row, so a job that isn't completed has no transcript.
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

describe("POST /jobs/transcribe/:audioUploadId/rerun", () => {
  const request = async () =>
    (await createApp()).request(
      `http://localhost/jobs/transcribe/${audioUploadId}/rerun`,
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
    expect(mockCleanupTerminalCaptionUpload).not.toHaveBeenCalled();
    expect(mockRequeueAudioJob).toHaveBeenCalledWith(
      "user_01OWNER",
      audioUploadId,
      "nova-3",
    );
    expect(mockDeleteTranscript).toHaveBeenCalledWith(audioUploadId);
    expect(mockPublish).toHaveBeenCalledWith("transcribe", { audioUploadId });
  });

  it("rejects YouTube jobs", async () => {
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      source: "youtube",
      youtubeSourceUrl: "https://www.youtube.com/watch?v=video",
    });

    const res = await request();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "YouTube jobs must use the YouTube rerun route",
    });
    expect(mockRequeueAudioJob).not.toHaveBeenCalled();
    expect(mockDeleteTranscript).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
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

describe("POST /jobs/youtube/:audioUploadId/rerun", () => {
  const youtubeUrl = "https://www.youtube.com/watch?v=video";
  const request = async (useCaptionsIfAvailable: boolean) => {
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      source: "youtube",
      youtubeSourceUrl: youtubeUrl,
    });
    return (await createApp()).request(
      `http://localhost/jobs/youtube/${audioUploadId}/rerun`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: await sessionCookieHeader("user_01OWNER"),
        },
        body: JSON.stringify({
          transcriptModelId: "nova-3",
          useCaptionsIfAvailable,
        }),
      },
    );
  };

  it("re-fetches captions under a fresh temporary upload id", async () => {
    const res = await request(true);
    const captionUploadId = mockRequeueAudioJob.mock.calls[0]?.[3] as string;

    expect(res.status).toBe(200);
    expect(captionUploadId).toEqual(expect.any(String));
    expect(mockCleanupTerminalCaptionUpload).toHaveBeenCalledWith(
      audioUploadId,
      "user_01OWNER",
    );
    expect(mockRequeueAudioJob).toHaveBeenCalledWith(
      "user_01OWNER",
      audioUploadId,
      "nova-3",
      captionUploadId,
    );
    expect(mockDeleteTranscript).toHaveBeenCalledWith(audioUploadId);
    expect(mockPublish).toHaveBeenCalledWith("yt_fetch", {
      audioUploadId,
      captionUploadId,
      userId: "user_01OWNER",
      url: youtubeUrl,
      useCaptionsIfAvailable: true,
    });
  });

  it("re-fetches audio when captions are disabled", async () => {
    const res = await request(false);

    expect(res.status).toBe(200);
    expect(mockRequeueAudioJob).toHaveBeenCalledWith(
      "user_01OWNER",
      audioUploadId,
      "nova-3",
      null,
    );
    expect(mockPublish).toHaveBeenCalledWith("yt_fetch", {
      audioUploadId,
      captionUploadId: null,
      userId: "user_01OWNER",
      url: youtubeUrl,
      useCaptionsIfAvailable: false,
    });
  });

  it("rejects non-YouTube jobs", async () => {
    mockFindAudioJob.mockReset();
    mockFindAudioJob.mockResolvedValueOnce(audioJob);

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/youtube/${audioUploadId}/rerun`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieHeader("user_01OWNER"),
      },
      body: JSON.stringify({ transcriptModelId: "nova-3" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "Only YouTube jobs can use the YouTube rerun route",
    });
    expect(mockRequeueAudioJob).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("does not requeue a YouTube job with no stored URL", async () => {
    mockFindAudioJob.mockReset();
    mockFindAudioJob.mockResolvedValueOnce({
      ...audioJob,
      source: "youtube",
      youtubeSourceUrl: null,
    });

    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/youtube/${audioUploadId}/rerun`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieHeader("user_01OWNER"),
      },
      body: JSON.stringify({ transcriptModelId: "nova-3" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "YouTube source URL is unavailable",
    });
    expect(mockRequeueAudioJob).not.toHaveBeenCalled();
    expect(mockDeleteTranscript).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
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
