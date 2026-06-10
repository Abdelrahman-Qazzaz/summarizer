import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 15 * 1024 * 1024;

const {
  mockInsert,
  mockSendEvent,
  mockUploadTextToBucket,
  mockUploadAudioToBucket,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSendEvent: vi.fn(),
  mockUploadTextToBucket: vi.fn(),
  mockUploadAudioToBucket: vi.fn(),
}));

vi.mock("../../shared/db", () => ({
  db: { insert: mockInsert },
  AudioTranscriptionJobs: {},
  TextSummarizationJobs: {},
}));

vi.mock("../../shared/bucket", () => ({
  uploadTextToBucket: mockUploadTextToBucket,
  uploadAudioToBucket: mockUploadAudioToBucket,
}));

vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: {
      TRANSCRIBE: "transcribe",
      SUMMARIZE: "summarize",
    },
    sendEvent: mockSendEvent,
  },
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";

function textUploadBody(content = "hello", fileName = "notes.txt"): FormData {
  const formData = new FormData();
  formData.append("file", new File([content], fileName, { type: "text/plain" }));
  return formData;
}

function audioUploadBody(
  sizeBytes: number,
  options?: { source?: string; fileName?: string },
): FormData {
  const formData = new FormData();
  formData.append(
    "file",
    new File([new Uint8Array(sizeBytes)], options?.fileName ?? "clip.mp3", {
      type: "audio/mpeg",
    }),
  );
  if (options?.source !== undefined) {
    formData.append("source", options.source);
  }
  return formData;
}

describe("POST /upload/text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockUploadTextToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await createApp().request("http://localhost/upload/text", {
      method: "POST",
      body: textUploadBody(),
    });
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when file field is missing", async () => {
    const formData = new FormData();
    const res = await createApp().request("http://localhost/upload/text", {
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
    const res = await createApp().request("http://localhost/upload/text", {
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
    const res = await createApp().request("http://localhost/upload/text", {
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
      body.uploadId,
      "sample text",
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("summarize", body.uploadId);
  });
});

describe("POST /upload/audio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockUploadAudioToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
  });

  it("returns 400 when file field is missing", async () => {
    const res = await createApp().request("http://localhost/upload/audio", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 when audio file is too large", async () => {
    const res = await createApp().request("http://localhost/upload/audio", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: audioUploadBody(MAX_AUDIO_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: "Audio file is too large",
      maxBytes: MAX_AUDIO_BYTES,
    });
  });

  it("returns 400 for invalid source", async () => {
    const res = await createApp().request("http://localhost/upload/audio", {
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
    const res = await createApp().request("http://localhost/upload/audio", {
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
