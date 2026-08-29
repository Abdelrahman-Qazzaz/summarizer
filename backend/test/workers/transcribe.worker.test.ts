import { describe, it, expect, vi, beforeEach } from "vitest";

const audioUploadId = "550e8400-e29b-41d4-a716-446655440000";
const captionUploadId = "650e8400-e29b-41d4-a716-446655440111";

const {
  mockSendEvent,
  mockReturning,
  mockWhere,
  mockSet,
  mockUpdate,
  mockCreateSignedUrl,
  mockCleanupTerminalCaptionUpload,
  mockGetTextFromBucket,
  mockTranscribeUrl,
  mockGenerateTitle,
  mockSaveCompletedTranscript,
} = vi.hoisted(() => ({
  mockSendEvent: vi.fn(),
  mockReturning: vi.fn(),
  mockWhere: vi.fn(),
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
  mockCleanupTerminalCaptionUpload: vi.fn(),
  mockGetTextFromBucket: vi.fn(),
  mockTranscribeUrl: vi.fn(),
  mockGenerateTitle: vi.fn(),
  mockSaveCompletedTranscript: vi.fn(),
}));

// Shape a Deepgram transcribeUrl response carrying a single transcript string.
function deepgramResponse(transcript: string) {
  return {
    results: { channels: [{ alternatives: [{ paragraphs: { transcript } }] }] },
  };
}

vi.mock("../../shared/bucket", () => ({
  createSignedUrl: mockCreateSignedUrl,
  getTextFromBucket: mockGetTextFromBucket,
  AUDIO_URL_TTL_SECONDS: 3600,
}));

vi.mock("../../shared/captionUploads", () => ({
  cleanupTerminalCaptionUpload: mockCleanupTerminalCaptionUpload,
}));

vi.mock("../../shared/ai/ai_chat_client", () => ({
  generateTitle: mockGenerateTitle,
}));

vi.mock("../../shared/data/transcripts.data", async (importActual) => ({
  ...(await importActual<
    typeof import("../../shared/data/transcripts.data")
  >()),
  saveCompletedTranscript: mockSaveCompletedTranscript,
}));

// Mock the Deepgram SDK called by transcribeAI().
vi.mock("@deepgram/sdk", () => ({
  DeepgramClient: class {
    listen = { v1: { media: { transcribeUrl: mockTranscribeUrl } } };
    auth = { v1: { tokens: { grant: vi.fn() } } };
  },
}));

vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: { TRANSCRIBE_DONE: "transcribe_done" },
    publish: mockSendEvent,
  },
}));

vi.mock("../../shared/db", async () => ({
  db: { update: mockUpdate },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

import { handleTranscribeJob } from "../../transcribe-worker/transcribeJob";

/**
 * The worker issues two updates: claim (which returns the row), then complete
 * (or fail). Only the first returns anything.
 */
function setupUpdateChain(claimedJobs: unknown[]) {
  let updateCall = 0;
  mockReturning.mockResolvedValue(claimedJobs);
  mockWhere.mockImplementation(() => {
    updateCall += 1;
    if (updateCall === 1) return { returning: mockReturning };
    return Promise.resolve(undefined);
  });
  mockSet.mockImplementation(() => ({ where: mockWhere }));
  mockUpdate.mockImplementation(() => ({ set: mockSet }));
}

const claimedJob = {
  audioUploadId,
  captionUploadId: null,
  userId: "user_01",
  fileName: "clip.mp3",
  status: "queued",
};

const audioInput = {
  audioUploadId,
  useCaptionUpload: false,
} as const;

describe("handleTranscribeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockResolvedValue("https://signed.example/audio");
    mockCleanupTerminalCaptionUpload.mockResolvedValue(false);
    mockGetTextFromBucket.mockResolvedValue("caption transcript");
    mockTranscribeUrl.mockResolvedValue(deepgramResponse("sample transcript"));
    mockGenerateTitle.mockResolvedValue("Sample recording");
    mockSaveCompletedTranscript.mockResolvedValue(true);
    mockSendEvent.mockResolvedValue(undefined);
    setupUpdateChain([claimedJob]);
  });

  it("transcribes audio, stores the transcript, and announces completion", async () => {
    await handleTranscribeJob(audioInput);

    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      "user_01",
      audioUploadId,
      expect.any(Number),
    );
    expect(mockTranscribeUrl).toHaveBeenCalled();
    // Transcript store + job-completion happen together (one transaction),
    // keyed by the job's own audioUploadId.
    expect(mockSaveCompletedTranscript).toHaveBeenCalledWith(
      "user_01",
      audioUploadId,
      "sample transcript",
      "Sample recording",
      expect.any(String),
    );
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe_done", {
      audioUploadId,
      userId: "user_01",
    });
  });

  it("stores an existing caption transcript without transcribing audio", async () => {
    setupUpdateChain([{ ...claimedJob, captionUploadId }]);

    await handleTranscribeJob({
      audioUploadId,
      useCaptionUpload: true,
    });

    expect(mockGetTextFromBucket).toHaveBeenCalledWith(
      "user_01",
      captionUploadId,
    );
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockTranscribeUrl).not.toHaveBeenCalled();
    expect(mockSaveCompletedTranscript).toHaveBeenCalledWith(
      "user_01",
      audioUploadId,
      "caption transcript",
      "Sample recording",
      expect.any(String),
    );
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe_done", {
      audioUploadId,
      userId: "user_01",
    });
    expect(mockCleanupTerminalCaptionUpload).toHaveBeenCalledWith(
      audioUploadId,
    );
  });

  it("fails when a caption delivery has no persisted caption upload", async () => {
    await expect(
      handleTranscribeJob({ audioUploadId, useCaptionUpload: true }),
    ).rejects.toThrow("Caption upload is missing");

    expect(mockGetTextFromBucket).not.toHaveBeenCalled();
    expect(mockSaveCompletedTranscript).not.toHaveBeenCalled();
    expect(mockCleanupTerminalCaptionUpload).toHaveBeenCalledWith(
      audioUploadId,
    );
  });

  it("no-ops when no queued job is claimed", async () => {
    setupUpdateChain([]);
    await handleTranscribeJob(audioInput);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockTranscribeUrl).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("does not announce a result after the worker loses its claim", async () => {
    mockSaveCompletedTranscript.mockResolvedValueOnce(false);

    await handleTranscribeJob(audioInput);

    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("processes a broker-redelivered job under a fresh claim token", async () => {
    await handleTranscribeJob(audioInput, { redelivered: true });

    expect(mockSet).toHaveBeenNthCalledWith(1, {
      status: "processing",
      claimToken: expect.any(String),
    });
    expect(mockSaveCompletedTranscript).toHaveBeenCalledWith(
      "user_01",
      audioUploadId,
      "sample transcript",
      "Sample recording",
      expect.any(String),
    );
  });

  it("uses the filename when title generation fails", async () => {
    mockGenerateTitle.mockRejectedValueOnce(new Error("title model failed"));

    await handleTranscribeJob(audioInput);

    expect(mockSaveCompletedTranscript).toHaveBeenCalledWith(
      "user_01",
      audioUploadId,
      "sample transcript",
      "clip.mp3",
      expect.any(String),
    );
  });

  it("rejects an empty transcript", async () => {
    mockTranscribeUrl.mockResolvedValueOnce(deepgramResponse("   "));
    await expect(handleTranscribeJob(audioInput)).rejects.toThrow(
      "Transcription produced no text",
    );
    expect(mockSaveCompletedTranscript).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("marks the job failed and rethrows when transcription fails", async () => {
    mockTranscribeUrl.mockRejectedValueOnce(new Error("transcription failed"));
    await expect(handleTranscribeJob(audioInput)).rejects.toThrow(
      "transcription failed",
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2); // claim + fail
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});
