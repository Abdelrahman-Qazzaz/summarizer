import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const {
  mockInsert,
  mockSendEvent,
  mockUploadAudioToBucket,
  mockUploadImageToBucket,
  mockCreateSignedUrl,
  mockIsValidTranscribeModel,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSendEvent: vi.fn(),
  mockUploadAudioToBucket: vi.fn(),
  mockUploadImageToBucket: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
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
  db: { insert: mockInsert },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", () => ({
  uploadTextToBucket: vi.fn(),
  uploadAudioToBucket: mockUploadAudioToBucket,
  uploadImageToBucket: mockUploadImageToBucket,
  createSignedUrl: mockCreateSignedUrl,
  createSignedUrls: vi.fn(),
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

function audioUploadBody(
  sizeBytes: number,
  options?: { source?: string; fileName?: string },
): FormData {
  const formData = new FormData();
  formData.append(
    "uploadFile",
    new File([new Uint8Array(sizeBytes)], options?.fileName ?? "clip.mp3", {
      type: "audio/mpeg",
    }),
  );
  if (options?.source !== undefined) {
    formData.append("audioSource", options.source);
  }
  return formData;
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
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockUploadAudioToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
    mockIsValidTranscribeModel.mockResolvedValue(true);
  });

  it("returns 400 when file field is missing", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: await authedHeaders("user_01"),
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  // Streams a real 100MB+ body through multipart parsing, so it needs a
  // generous timeout beyond the 5s default.
  it("returns 413 when audio file is too large", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: await authedHeaders("user_01"),
      body: audioUploadBody(MAX_AUDIO_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: "Audio file is too large",
      maxBytes: MAX_AUDIO_BYTES,
    });
  }, 20000);

  it("returns 400 for invalid source", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: await authedHeaders("user_01"),
      body: audioUploadBody(100, { source: "invalid" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Invalid source; use "video" or "audio" (or omit)',
    });
  });

  it("uploads audio and enqueues transcribe", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: await authedHeaders("user_01"),
      body: audioUploadBody(100, { source: "video", fileName: "clip.mp3" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      fileName: string;
      source: string;
      audioUploadId: string;
    };
    expect(body.message).toBe("File uploaded");
    expect(body.fileName).toBe("clip.mp3");
    expect(body.source).toBe("video");
    expect(typeof body.audioUploadId).toBe("string");
    expect(mockUploadAudioToBucket).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe", {
      audioUploadId: body.audioUploadId,
    });
  });

  it("rejects a multipart upload from a foreign origin", async () => {
    // multipart/form-data is CORS-safelisted, so this request is sent without
    // a preflight and carries the session cookie (SameSite=None in
    // production). csrf() is the only thing standing between a hostile page
    // and an upload made as the signed-in user.
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: {
        ...(await authedHeaders("user_01")),
        Origin: "https://evil.example",
      },
      body: audioUploadBody(100, { source: "audio", fileName: "clip.mp3" }),
    });
    expect(res.status).toBe(403);
    expect(mockUploadAudioToBucket).not.toHaveBeenCalled();
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
    expect(mockInsert).toHaveBeenCalledTimes(1);
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
    const insertedJob = mockValues.mock.calls[0]?.[0] as {
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
