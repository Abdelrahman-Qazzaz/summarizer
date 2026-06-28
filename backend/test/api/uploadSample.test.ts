import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockInsert,
  mockSendEvent,
  mockUploadTextToBucket,
  mockUploadAudioToBucket,
  mockValidateModel,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSendEvent: vi.fn(),
  mockUploadTextToBucket: vi.fn(),
  mockUploadAudioToBucket: vi.fn(),
  mockValidateModel: vi.fn(),
}));

vi.mock("../../shared/ai/ai_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_client")>();
  return {
    ...actual,
    validateModel: mockValidateModel,
  };
});

import { DEFAULT_MODELS } from "../../shared/ai/ai_client";

const VALID_MODEL = DEFAULT_MODELS.PROMPT;

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
import {
  loadSampleFile,
  SAMPLE_TEXT_NAME,
  SAMPLE_AUDIO_NAME,
} from "../helpers/sampleFiles";

// Real contents of test/sample/test.txt
const SAMPLE_TEXT_CONTENT = "hi there!";

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  mockUploadTextToBucket.mockResolvedValue(undefined);
  mockUploadAudioToBucket.mockResolvedValue(undefined);
  mockSendEvent.mockResolvedValue(undefined);
  mockValidateModel.mockResolvedValue(true);
});

describe("POST /upload/text with sample file", () => {
  it("uploads test.txt and enqueues summarize", async () => {
    const file = await loadSampleFile(SAMPLE_TEXT_NAME, "text/plain");
    const formData = new FormData();
    formData.append("uploadFile", file);
    formData.append("chosenModelId", VALID_MODEL);

    const res = await (await createApp()).request(
      "http://localhost/upload/text",
      {
        method: "POST",
        headers: { Cookie: await sessionCookieHeader("user_01") },
        body: formData,
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      message: string;
      fileName: string;
      size: number;
      mode: string;
      preview: string;
      uploadId: string;
    };
    expect(body.message).toBe("File uploaded");
    expect(body.fileName).toBe(SAMPLE_TEXT_NAME);
    expect(body.mode).toBe("text");
    expect(body.size).toBe(file.size);
    expect(body.preview).toBe(SAMPLE_TEXT_CONTENT);
    expect(typeof body.uploadId).toBe("string");

    expect(mockUploadTextToBucket).toHaveBeenCalledWith(
      body.uploadId,
      SAMPLE_TEXT_CONTENT,
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("summarize", body.uploadId);
  });
});

describe("POST /upload/audio with sample file", () => {
  it("uploads audio_speech.flac and enqueues transcribe", async () => {
    const file = await loadSampleFile(SAMPLE_AUDIO_NAME, "audio/flac");
    const formData = new FormData();
    formData.append("uploadFile", file);
    formData.append("audioSource", "audio");
    formData.append("chosenModelId", VALID_MODEL);

    const res = await (await createApp()).request(
      "http://localhost/upload/audio",
      {
        method: "POST",
        headers: { Cookie: await sessionCookieHeader("user_01") },
        body: formData,
      },
    );

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
    const [uploadIdArg, fileArg] = mockUploadAudioToBucket.mock.calls[0];
    expect(uploadIdArg).toBe(body.uploadId);
    expect(fileArg).toBeInstanceOf(File);
    expect(fileArg.size).toBe(file.size);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe", body.uploadId);
  });
});
