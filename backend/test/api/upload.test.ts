import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const {
  mockInsert,
  mockSendEvent,
  mockUploadAudioToBucket,
  mockUploadImageToBucket,
  mockCreateSignedUrl,
  mockValidateModel,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSendEvent: vi.fn(),
  mockUploadAudioToBucket: vi.fn(),
  mockUploadImageToBucket: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
  mockValidateModel: vi.fn(),
}));

const { mockGetModelData } = vi.hoisted(() => ({
  mockGetModelData: vi.fn(),
}));
vi.mock("../../shared/ai/ai_chat_client", async (importActual) => {
  // importActual is the correct way to get real values inside vi.mock
  const actual =
    await importActual<typeof import("../../shared/ai/ai_chat_client")>();
  return {
    ...actual, // preserves DEFAULT_MODELS and anything else
    getModelData: mockGetModelData, // override only what needs mocking
    validateChatModelOutput: mockValidateModel,
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
    sendEvent: mockSendEvent,
  },
}));

import { createApp } from "../../api/app";
import { sessionCookieHeader } from "../helpers/session";

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
      headers: { Cookie: await sessionCookieHeader("user_01") },
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
    mockValidateModel.mockResolvedValue(true);
  });

  it("returns 400 when file field is missing", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
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
      headers: { Cookie: await sessionCookieHeader("user_01") },
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
      headers: { Cookie: await sessionCookieHeader("user_01") },
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
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: audioUploadBody(100, { source: "video", fileName: "clip.mp3" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      fileName: string;
      source: string;
      uploadId: string;
    };
    expect(body.message).toBe("File uploaded");
    expect(body.fileName).toBe("clip.mp3");
    expect(body.source).toBe("video");
    expect(typeof body.uploadId).toBe("string");
    expect(mockUploadAudioToBucket).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe", body.uploadId);
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
    mockValidateModel.mockResolvedValue(true);
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
      uploadId: string;
    };
    expect(body.source).toBe("youtube");
    expect(body.url).toBe(YT_URL);
    expect(typeof body.uploadId).toBe("string");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    // The row persists the origin URL (for history + future transcript caching).
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ source: "youtube", YT_sourceUrl: YT_URL }),
    );
    // The fetch event carries the url + userId the fetcher needs (bucket write
    // happens in Python; the API only enqueues).
    expect(mockSendEvent).toHaveBeenCalledWith("yt_fetch", {
      uploadId: body.uploadId,
      url: YT_URL,
      userId: "user_01",
    });
  });
});
