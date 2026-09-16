import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const {
  mockInsert,
  mockSendEvent,
  mockCreateAudioUploadUrl,
  mockTakeUploadedAudio,
  mockIsValidTranscribeModel,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSendEvent: vi.fn(),
  mockCreateAudioUploadUrl: vi.fn(),
  mockTakeUploadedAudio: vi.fn(),
  mockIsValidTranscribeModel: vi.fn(),
}));

const { mockgetChatModelData } = vi.hoisted(() => ({
  mockgetChatModelData: vi.fn(),
}));
vi.mock("../../shared/ai/ai_chat_client", async (importActual) => {
  // importActual is the correct way to get real values inside vi.mock
  const actual =
    await importActual<typeof import("../../shared/ai/ai_chat_client")>();
  return {
    ...actual, // preserves DEFAULT_MODELS and anything else
    getChatModelData: mockgetChatModelData, // override only what needs mocking
  };
});

vi.mock("../../shared/ai/ai_transcribe_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_transcribe_client")>();
  return {
    ...actual, // preserves DEFAULT_TRANSCRIBE_MODEL
    isValidTranscribeModel: mockIsValidTranscribeModel,
  };
});

vi.mock("../../shared/db", async () => ({
  db: {
    insert: mockInsert,
    // createAudioJob writes both rows in one transaction; run it against the
    // same insert mock so those writes are recorded like plain ones.
    transaction: (run: (tx: unknown) => unknown) => run({ insert: mockInsert }),
  },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", () => ({
  createAudioUploadUrl: mockCreateAudioUploadUrl,
  takeUploadedAudio: mockTakeUploadedAudio,
  createSignedImageUrl: vi.fn(),
  createSignedImageUrls: vi.fn(),
  // Literals (not the top-level consts): vi.mock factories can run during
  // import evaluation, before this module's own bindings initialize.
  BUCKET: "Audio & Text files",
  MAX_AUDIO_BYTES: 100 * 1024 * 1024,
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: {
      TRANSCRIBE: "transcribe",
      YT_FETCH: "yt_fetch",
    },
    publish: mockSendEvent,
  },
}));

import { createApp } from "../../api/app";
import { authedHeaders, sessionCookieHeader } from "../helpers/session";

async function postJson(path: string, body: unknown, userId = "user_01") {
  return (await createApp()).request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await sessionCookieHeader(userId),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /upload/text", () => {
  it("is gone — summarization is a chat prompt now", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: await authedHeaders("user_01"),
      body: new FormData(),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /upload/audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAudioUploadUrl.mockResolvedValue("https://storage.test/upload");
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(401);
    expect(mockCreateAudioUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a fresh id and a URL bound to it", async () => {
    const res = await postJson("/upload/audio", {});

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      uploadId: string;
      signedUploadUrl: string;
    };
    expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.signedUploadUrl).toBe("https://storage.test/upload");
    expect(mockCreateAudioUploadUrl).toHaveBeenCalledWith(
      "user_01",
      body.uploadId,
    );
  });

  // Minting writes nothing: an upload that never lands leaves no job behind.
  it("writes no row and queues nothing", async () => {
    await postJson("/upload/audio", {});

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});

describe("POST /upload/audio/confirm", () => {
  const UPLOAD_ID = "11111111-1111-4111-8111-111111111111";
  let mockValues: ReturnType<typeof vi.fn>;

  function confirmBody(overrides: Record<string, unknown> = {}) {
    return {
      uploadId: UPLOAD_ID,
      fileName: "talk.webm",
      audioSource: "video",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockValues = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
    mockSendEvent.mockResolvedValue(undefined);
    mockIsValidTranscribeModel.mockResolvedValue(true);
    mockTakeUploadedAudio.mockResolvedValue({
      ok: true,
      sizeBytes: 2048,
      contentType: "audio/webm",
    });
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmBody()),
    });

    expect(res.status).toBe(401);
    expect(mockTakeUploadedAudio).not.toHaveBeenCalled();
  });

  it("returns 400 for an id that is not a uuid", async () => {
    const res = await postJson(
      "/upload/audio/confirm",
      confirmBody({ uploadId: "not-a-uuid" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "Invalid upload id" });
    expect(mockTakeUploadedAudio).not.toHaveBeenCalled();
  });

  it("returns 400 without a file name", async () => {
    const res = await postJson(
      "/upload/audio/confirm",
      confirmBody({ fileName: "  " }),
    );

    expect(res.status).toBe(400);
    expect(mockTakeUploadedAudio).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid source", async () => {
    const res = await postJson(
      "/upload/audio/confirm",
      confirmBody({ audioSource: "invalid" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Invalid source; use "video" or "audio" (or omit)',
    });
  });

  // Also what an id minted for an image gets: its object is under images/.
  it("returns 404 when no audio was uploaded under the id", async () => {
    mockTakeUploadedAudio.mockResolvedValue({ ok: false, reason: "missing" });

    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      message: "No uploaded audio to confirm",
    });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when storage holds something other than audio", async () => {
    mockTakeUploadedAudio.mockResolvedValue({
      ok: false,
      reason: "wrong-type",
      contentType: "application/zip",
    });

    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "Expected an audio file, got: application/zip",
    });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("names the type as unknown when storage recorded none", async () => {
    mockTakeUploadedAudio.mockResolvedValue({
      ok: false,
      reason: "wrong-type",
      contentType: "",
    });

    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(await res.json()).toEqual({
      message: "Expected an audio file, got: unknown",
    });
  });

  it("returns 413 when the stored object is over the cap", async () => {
    mockTakeUploadedAudio.mockResolvedValue({
      ok: false,
      reason: "too-large",
      contentType: "audio/webm",
    });

    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: "Audio file is too large",
      maxBytes: MAX_AUDIO_BYTES,
    });
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("records the stored size and type, then queues transcription", async () => {
    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "File uploaded",
      audioUploadId: UPLOAD_ID,
      fileName: "talk.webm",
      size: 2048,
      mimeType: "audio/webm",
      source: "video",
    });
    expect(mockTakeUploadedAudio).toHaveBeenCalledWith("user_01", UPLOAD_ID);
    // The attachment row, then the job row.
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: UPLOAD_ID,
        kind: "audio",
        userId: "user_01",
        fileName: "talk.webm",
        mimeType: "audio/webm",
        sizeBytes: 2048,
      }),
    );
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        audioUploadId: UPLOAD_ID,
        captionUploadId: null,
        source: "video",
      }),
    );
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe", {
      audioUploadId: UPLOAD_ID,
    });
  });

  it("defaults the source to audio", async () => {
    const res = await postJson(
      "/upload/audio/confirm",
      confirmBody({ audioSource: undefined }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: "audio" });
  });

  // A double-click, or a retried confirm whose response was lost. drizzle
  // wraps the driver error, so the code sits on the cause.
  it("returns 409 on a repeat confirm and queues nothing", async () => {
    mockValues.mockRejectedValueOnce(
      new Error("Failed query", {
        cause: Object.assign(new Error("duplicate key value"), {
          code: "23505",
        }),
      }),
    );

    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "This upload was already confirmed",
    });
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("still fails loudly on any other database error", async () => {
    mockValues.mockRejectedValueOnce(new Error("connection reset"));

    const res = await postJson("/upload/audio/confirm", confirmBody());

    expect(res.status).toBe(500);
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});

describe("POST /upload/youtube", () => {
  const YT_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  // Captured so we can assert the inserted row (e.g. YT_sourceUrl) directly.
  let mockValues: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValues = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
    mockSendEvent.mockResolvedValue(undefined);
    mockIsValidTranscribeModel.mockResolvedValue(true);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeUrl: YT_URL }),
    });
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-YouTube URL", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/youtube", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieHeader("user_01"),
      },
      body: JSON.stringify({ youtubeUrl: "https://example.com/watch?v=x" }),
    });
    expect(res.status).toBe(400);
    // The schema's own message must reach the client, not a generic string.
    expect(await res.json()).toEqual({ message: "Not a valid YouTube URL" });
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("creates a job and enqueues fetch with the url + userId", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/youtube", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieHeader("user_01"),
      },
      body: JSON.stringify({ youtubeUrl: YT_URL }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      source: string;
      url: string;
      audioUploadId: string;
    };
    expect(body.source).toBe("youtube");
    expect(body.url).toBe(YT_URL);
    expect(typeof body.audioUploadId).toBe("string");
    // The attachment row, then the job row.
    expect(mockInsert).toHaveBeenCalledTimes(2);
    // The row persists the origin URL (for history + future transcript caching).
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        captionUploadId: null,
        source: "youtube",
        YT_sourceUrl: YT_URL,
      }),
    );
    // The fetch event carries the url + userId the fetcher needs (bucket write
    // happens in Python; the API only enqueues).
    expect(mockSendEvent).toHaveBeenCalledWith("yt_fetch", {
      audioUploadId: body.audioUploadId,
      captionUploadId: null,
      url: YT_URL,
      userId: "user_01",
      useCaptionsIfAvailable: false,
    });
  });

  it("forwards the caption preference to the fetcher", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/youtube", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: await sessionCookieHeader("user_01"),
      },
      body: JSON.stringify({
        youtubeUrl: YT_URL,
        useCaptionsIfAvailable: true,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { audioUploadId: string };
    const insertedJob = mockValues.mock.calls
      .map(([values]) => values as { captionUploadId?: string })
      .find((values) => "captionUploadId" in values) as {
      captionUploadId: string;
    };
    expect(insertedJob.captionUploadId).toEqual(expect.any(String));
    expect(mockSendEvent).toHaveBeenCalledWith("yt_fetch", {
      audioUploadId: body.audioUploadId,
      captionUploadId: insertedJob.captionUploadId,
      url: YT_URL,
      userId: "user_01",
      useCaptionsIfAvailable: true,
    });
  });
});
