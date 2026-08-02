import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";
const generatedTranscriptId = "660e8400-e29b-41d4-a716-446655440001";
const existingTranscriptId = "770e8400-e29b-41d4-a716-446655440002";

const {
  mockSendEvent,
  mockReturning,
  mockWhere,
  mockSet,
  mockUpdate,
  mockGetAudioFile,
  mockTranscribe,
  mockUploadTextToBucket,
} = vi.hoisted(() => ({
  mockSendEvent: vi.fn(),
  mockReturning: vi.fn(),
  mockWhere: vi.fn(),
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetAudioFile: vi.fn(),
  mockTranscribe: vi.fn(),
  mockUploadTextToBucket: vi.fn(),
}));

vi.mock("crypto", () => ({
  randomUUID: () => generatedTranscriptId,
}));

vi.mock("../../shared/bucket", () => ({
  getAudioFile: mockGetAudioFile,
  uploadTextToBucket: mockUploadTextToBucket,
}));

vi.mock("../../shared/ai/transcribe", () => ({
  transcribe: mockTranscribe,
}));

vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: { TRANSCRIBE_DONE: "transcribe_done" },
    sendEvent: mockSendEvent,
  },
}));

vi.mock("../../shared/db", async () => ({
  db: { update: mockUpdate },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

import { handleTranscribeJob } from "../../services/transcribe-service/workers/transcribe.worker";

/**
 * The worker issues two updates: claim (which returns the row), then complete
 * — which carries the transcript key. Only the first returns anything.
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
  uploadId,
  userId: "user_01",
  fileName: "clip.mp3",
  status: "queued",
  transcriptUploadId: null,
};

describe("handleTranscribeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAudioFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockTranscribe.mockResolvedValue("sample transcript");
    mockUploadTextToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
    setupUpdateChain([claimedJob]);
  });

  it("transcribes audio, stores the transcript, and announces completion", async () => {
    await handleTranscribeJob(uploadId);

    expect(mockGetAudioFile).toHaveBeenCalledWith("user_01", uploadId);
    expect(mockTranscribe).toHaveBeenCalled();
    expect(mockUploadTextToBucket).toHaveBeenCalledWith(
      "user_01",
      generatedTranscriptId,
      "sample transcript",
      { upsert: true },
    );
    // claim + complete (which carries the transcript key)
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenLastCalledWith({
      status: "completed",
      transcriptUploadId: generatedTranscriptId,
    });
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe_done", {
      uploadId,
      userId: "user_01",
    });
  });

  it("reuses the existing transcript key on a re-run", async () => {
    setupUpdateChain([
      { ...claimedJob, transcriptUploadId: existingTranscriptId },
    ]);

    await handleTranscribeJob(uploadId);

    // Overwrites the object it wrote last time rather than minting a new key,
    // which would strand the previous transcript in the bucket.
    expect(mockUploadTextToBucket).toHaveBeenCalledWith(
      "user_01",
      existingTranscriptId,
      "sample transcript",
      { upsert: true },
    );
  });

  it("no-ops when no queued job is claimed", async () => {
    setupUpdateChain([]);
    await handleTranscribeJob(uploadId);
    expect(mockGetAudioFile).not.toHaveBeenCalled();
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("rejects an empty transcript", async () => {
    mockTranscribe.mockResolvedValueOnce("   ");
    await expect(handleTranscribeJob(uploadId)).rejects.toThrow(
      "Transcription produced no text",
    );
    expect(mockUploadTextToBucket).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("marks the job failed and rethrows when transcription fails", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("transcription failed"));
    await expect(handleTranscribeJob(uploadId)).rejects.toThrow(
      "transcription failed",
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2); // claim + fail
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});
