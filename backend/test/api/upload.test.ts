import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const {
  mockInsert,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockSendEvent,
  mockUploadTextToBucket,
  mockUploadAudioToBucket,
  mockUploadImageToBucket,
  mockGetSignedUrl,
  mockGetSignedUrls,
  mockUpdate,
  mockValidateModel,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockSendEvent: vi.fn(),
  mockUploadTextToBucket: vi.fn(),
  mockUploadAudioToBucket: vi.fn(),
  mockUploadImageToBucket: vi.fn(),
  mockGetSignedUrl: vi.fn(),
  mockGetSignedUrls: vi.fn(),
  mockUpdate: vi.fn(),
  mockValidateModel: vi.fn(),
}));

const { mockGetModelData } = vi.hoisted(() => ({
  mockGetModelData: vi.fn(),
}));
vi.mock("../../shared/ai/ai_client", async (importActual) => {
  // importActual is the correct way to get real values inside vi.mock
  const actual =
    await importActual<typeof import("../../shared/ai/ai_client")>();
  return {
    ...actual, // preserves DEFAULT_MODELS and anything else
    getModelData: mockGetModelData, // override only what needs mocking
    validateModel: mockValidateModel,
  };
});

import { DEFAULT_MODELS } from "../../shared/ai/ai_client";

const VALID_MODEL = DEFAULT_MODELS.PROMPT;

vi.mock("../../shared/db", () => ({
  db: { insert: mockInsert, select: mockSelect, update: mockUpdate },
  AudioTranscriptionJobs: {},
  TextSummarizationJobs: {},
  ImageUploads: { uploadId: "upload_id", userId: "user_id" },
  jobStatusEnum: {
    enumValues: ["queued", "processing", "completed", "failed"],
  },
}));

vi.mock("../../shared/bucket", () => ({
  uploadTextToBucket: mockUploadTextToBucket,
  uploadAudioToBucket: mockUploadAudioToBucket,
  uploadImageToBucket: mockUploadImageToBucket,
  getSignedUrl: mockGetSignedUrl,
  getSignedUrls: mockGetSignedUrls,
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
  // Literals (not the top-level consts): vi.mock factories can run during
  // import evaluation, before this module's own bindings initialize.
  BUCKET: "Audio & Text files",
  MAX_AUDIO_BYTES: 100 * 1024 * 1024,
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
}));

vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: {
      TRANSCRIBE: "transcribe",
      SUMMARIZE: "summarize",
      YT_FETCH: "yt_fetch",
    },
    sendEvent: mockSendEvent,
  },
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
import {
  loadSampleFile,
  SAMPLE_PDF_NAME,
  SAMPLE_EMPTY_PDF_NAME,
} from "../helpers/sampleFiles";

function textUploadBody(content = "hello", fileName = "notes.txt"): FormData {
  const formData = new FormData();
  formData.append(
    "uploadFile",
    new File([content], fileName, { type: "text/plain" }),
  );
  formData.append("chosenModelId", VALID_MODEL);
  return formData;
}

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
  formData.append("chosenModelId", VALID_MODEL);
  return formData;
}

describe("POST /upload/text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockUploadTextToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
    mockValidateModel.mockResolvedValue(true);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      body: textUploadBody(),
    });
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when file field is missing", async () => {
    const formData = new FormData();
    formData.append("chosenModelId", VALID_MODEL);
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: formData,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Expected a file field named "file"',
    });
  });

  it("returns 413 when text file is too large", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: textUploadBody("x".repeat(MAX_TEXT_BYTES + 1)),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: "Text file is too large",
      maxBytes: MAX_TEXT_BYTES,
    });
  });

  it("uploads text and enqueues summarize", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: textUploadBody("sample text"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      fileName: string;
      mode: string;
      preview: string;
      uploadId: string;
    };
    expect(body.message).toBe("File uploaded");
    expect(body.fileName).toBe("notes.txt");
    expect(body.mode).toBe("text");
    expect(body.preview).toBe("sample text");
    expect(typeof body.uploadId).toBe("string");
    expect(mockUploadTextToBucket).toHaveBeenCalledWith(
      "user_01",
      body.uploadId,
      "sample text",
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("summarize", body.uploadId);
  });
});

// PDFs ride the same route; extraction runs for real (unpdf is not mocked).
describe("POST /upload/text with PDFs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockUploadTextToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
    mockValidateModel.mockResolvedValue(true);
  });

  async function pdfUploadBody(file: File): Promise<FormData> {
    const formData = new FormData();
    formData.append("uploadFile", file);
    formData.append("chosenModelId", VALID_MODEL);
    return formData;
  }

  it("extracts text from a PDF and enqueues summarize", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: await pdfUploadBody(
        await loadSampleFile(SAMPLE_PDF_NAME, "application/pdf"),
      ),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fileName: string;
      preview: string;
      uploadId: string;
    };
    expect(body.fileName).toBe(SAMPLE_PDF_NAME);
    expect(body.preview).toContain("hi there pdf");
    // The bucket receives the extracted text, never PDF bytes.
    expect(mockUploadTextToBucket).toHaveBeenCalledWith(
      "user_01",
      body.uploadId,
      expect.stringContaining("hi there pdf"),
    );
    expect(mockSendEvent).toHaveBeenCalledWith("summarize", body.uploadId);
  });

  it("returns 422 for a PDF with no text layer, without side effects", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: await pdfUploadBody(
        await loadSampleFile(SAMPLE_EMPTY_PDF_NAME, "application/pdf"),
      ),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("scanned");
    expect(mockUploadTextToBucket).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("returns 422 for unparseable PDF bytes, without side effects", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/text", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: await pdfUploadBody(
        new File([new Uint8Array([1, 2, 3])], "x.pdf", {
          type: "application/pdf",
        }),
      ),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ message: "Could not parse PDF file." });
    expect(mockUploadTextToBucket).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
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
      body: JSON.stringify({ youtubeUrl: YT_URL, chosenModelId: VALID_MODEL }),
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
      body: JSON.stringify({
        youtubeUrl: "https://example.com/watch?v=x",
        chosenModelId: VALID_MODEL,
      }),
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
      body: JSON.stringify({ youtubeUrl: YT_URL, chosenModelId: VALID_MODEL }),
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

function imageUploadBody(
  sizeBytes = 100,
  options?: { fileName?: string; type?: string },
): FormData {
  const formData = new FormData();
  formData.append(
    "uploadFile",
    new File([new Uint8Array(sizeBytes)], options?.fileName ?? "photo.png", {
      type: options?.type ?? "image/png",
    }),
  );
  return formData;
}

describe("POST /upload/image", () => {
  let mockImageValues: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockImageValues = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockImageValues });
    mockUploadImageToBucket.mockResolvedValue(undefined);
    mockGetSignedUrl.mockResolvedValue("https://signed.example/photo.png");
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image", {
      method: "POST",
      body: imageUploadBody(),
    });
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-image file", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: imageUploadBody(10, { type: "text/plain" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "File must be an image" });
    expect(mockUploadImageToBucket).not.toHaveBeenCalled();
  });

  it("returns 413 when the image is too large", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: imageUploadBody(MAX_IMAGE_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: "Image is too large",
      maxBytes: MAX_IMAGE_BYTES,
    });
  });

  it("uploads the image and returns a signed url — no job is enqueued", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: imageUploadBody(100, { fileName: "cat.png" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      fileName: string;
      mode: string;
      url: string;
      uploadId: string;
    };
    expect(body.message).toBe("File uploaded");
    expect(body.fileName).toBe("cat.png");
    expect(body.mode).toBe("image");
    expect(body.url).toBe("https://signed.example/photo.png");
    expect(typeof body.uploadId).toBe("string");
    expect(mockUploadImageToBucket).toHaveBeenCalledWith(
      "user_01",
      body.uploadId,
      expect.any(File),
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("caches the signed url on the row so sending never has to sign", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: imageUploadBody(100, { fileName: "cat.png" }),
    });
    expect(res.status).toBe(200);

    expect(mockImageValues).toHaveBeenCalledWith(
      expect.objectContaining({
        signedUrl: "https://signed.example/photo.png",
        signedUrlExpiresAt: expect.any(Date),
      }),
    );
    // Signed once, here — while the user is still typing.
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
  });
});

describe("GET /upload/image/:uploadId", () => {
  const uploadId = "550e8400-e29b-41d4-a716-446655440000";
  const row = {
    uploadId,
    fileName: "cat.png",
    mimeType: "image/png",
    sizeBytes: 1234,
    userId: "user_01",
  };
  const HOUR = 60 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockUpdate.mockImplementation(() => ({
      set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
    }));
    mockGetSignedUrl.mockResolvedValue("https://signed.example/photo.png");
    mockGetSignedUrls.mockResolvedValue(
      new Map([[uploadId, "https://signed.example/photo.png"]]),
    );
  });

  it("returns 404 when the image doesn't exist or isn't owned by the caller", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/upload/image/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(404);
  });

  it("serves the cached url without signing", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        ...row,
        signedUrl: "https://signed.example/cached.png",
        signedUrlExpiresAt: new Date(Date.now() + 48 * HOUR),
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/upload/image/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uploadId,
      fileName: "cat.png",
      mimeType: "image/png",
      size: 1234,
      url: "https://signed.example/cached.png",
    });
    expect(mockGetSignedUrls).not.toHaveBeenCalled();
  });

  it("re-signs and writes back when the cached url is near expiry", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        ...row,
        signedUrl: "https://signed.example/stale.png",
        // Inside the refresh margin, so it counts as stale.
        signedUrlExpiresAt: new Date(Date.now() + HOUR / 2),
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/upload/image/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uploadId,
      fileName: "cat.png",
      mimeType: "image/png",
      size: 1234,
      url: "https://signed.example/photo.png",
    });
    expect(mockGetSignedUrls).toHaveBeenCalledTimes(1);
    // The refreshed url is persisted, so the next read is free again.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("re-signs a row that has never been signed", async () => {
    mockLimit.mockResolvedValueOnce([row]);
    const res = await (
      await createApp()
    ).request(`http://localhost/upload/image/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(mockGetSignedUrls).toHaveBeenCalledTimes(1);
  });
});
