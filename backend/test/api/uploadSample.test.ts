import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockInsert,
  mockSendEvent,
  mockUploadAudioToBucket,
  mockValidateModel,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSendEvent: vi.fn(),
  mockUploadAudioToBucket: vi.fn(),
  mockValidateModel: vi.fn(),
}));

vi.mock("../../shared/ai/ai_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_client")>();
  return {
    ...actual,
    validateModelOutput: mockValidateModel,
  };
});

vi.mock("../../shared/db", async () => ({
  db: { insert: mockInsert },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", () => ({
  uploadTextToBucket: vi.fn(),
  uploadAudioToBucket: mockUploadAudioToBucket,
  uploadImageToBucket: vi.fn(),
  createSignedUrl: vi.fn(),
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
    queues: { TRANSCRIBE: "transcribe" },
    sendEvent: mockSendEvent,
  },
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
import { loadSampleFile, SAMPLE_AUDIO_NAME } from "../helpers/sampleFiles";

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  mockUploadAudioToBucket.mockResolvedValue(undefined);
  mockSendEvent.mockResolvedValue(undefined);
  mockValidateModel.mockResolvedValue(true);
});

describe("POST /upload/audio with sample file", () => {
  it("uploads audio_speech.flac and enqueues transcribe", async () => {
    const file = await loadSampleFile(SAMPLE_AUDIO_NAME, "audio/flac");
    const formData = new FormData();
    formData.append("uploadFile", file);
    formData.append("audioSource", "audio");

    const res = await (
      await createApp()
    ).request("http://localhost/upload/audio", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01") },
      body: formData,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      fileName: string;
      size: number;
      mimeType: string | null;
      source: string;
      uploadId: string;
    };
    expect(body.message).toBe("File uploaded");
    expect(body.fileName).toBe(SAMPLE_AUDIO_NAME);
    expect(body.source).toBe("audio");
    expect(body.size).toBe(file.size);
    expect(body.mimeType).toBe("audio/flac");
    expect(typeof body.uploadId).toBe("string");

    expect(mockUploadAudioToBucket).toHaveBeenCalledTimes(1);
    const [userIdArg, uploadIdArg, fileArg] =
      mockUploadAudioToBucket.mock.calls[0];
    expect(userIdArg).toBe("user_01");
    expect(uploadIdArg).toBe(body.uploadId);
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.size).toBe(file.size);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe", body.uploadId);
  });
});
