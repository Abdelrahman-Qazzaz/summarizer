import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";
const textUploadId = "660e8400-e29b-41d4-a716-446655440001";

const {
  mockSendEvent,
  mockReturning,
  mockWhere,
  mockSet,
  mockUpdate,
  mockInsert,
  mockSelect,
  mockGetAudioFile,
  mockTranscribe,
  mockUploadTextToBucket,
} = vi.hoisted(() => ({
  mockSendEvent: vi.fn(),
  mockReturning: vi.fn(),
  mockWhere: vi.fn(),
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockGetAudioFile: vi.fn(),
  mockTranscribe: vi.fn(),
  mockUploadTextToBucket: vi.fn(),
}));

vi.mock("crypto", () => ({
  randomUUID: () => textUploadId,
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
    queues: {
      TRANSCRIBE_DONE: "transcribe_done",
      SUMMARIZE: "summarize",
    },
    sendEvent: mockSendEvent,
  },
}));

vi.mock("../../shared/db", () => ({
  db: { update: mockUpdate, insert: mockInsert, select: mockSelect },
  AudioTranscriptionJobs: {
    uploadId: "upload_id",
    status: "status",
  },
  TextSummarizationJobs: {
    uploadId: "upload_id",
    audioUploadId: "audio_upload_id",
  },
}));

import { handleTranscribeJob } from "../../services/transcribe-summarize-service/workers/transcribe.worker";

function setupUpdateChain(returningJobs: unknown[]) {
  let updateCall = 0;
  mockReturning.mockResolvedValue(returningJobs);
  mockWhere.mockImplementation(() => {
    updateCall += 1;
    if (updateCall === 1) {
      return { returning: mockReturning };
    }
    return Promise.resolve(undefined);
  });
  mockSet.mockImplementation(() => ({ where: mockWhere }));
  mockUpdate.mockImplementation(() => ({ set: mockSet }));
}

describe("handleTranscribeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAudioFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockTranscribe.mockResolvedValue("sample transcript");
    mockUploadTextToBucket.mockResolvedValue(undefined);
    mockSendEvent.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    // No existing child summary row → worker takes the insert (first-run) path.
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    setupUpdateChain([
      {
        uploadId,
        userId: "user_01",
        fileName: "clip.mp3",
        status: "queued",
      },
    ]);
  });

  it("transcribes audio and enqueues summarize", async () => {
    await handleTranscribeJob(uploadId);
    expect(mockGetAudioFile).toHaveBeenCalledWith(uploadId);
    expect(mockTranscribe).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockSendEvent).toHaveBeenCalledWith("transcribe_done", {
      uploadId,
      userId: "user_01",
    });
    expect(mockUploadTextToBucket).toHaveBeenCalledWith(
      textUploadId,
      "sample transcript",
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSendEvent).toHaveBeenCalledWith("summarize", textUploadId);
  });

  it("no-ops when no queued job is claimed", async () => {
    setupUpdateChain([]);
    await handleTranscribeJob(uploadId);
    expect(mockGetAudioFile).not.toHaveBeenCalled();
    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("marks the job failed and rethrows when transcription fails", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("transcription failed"));
    await expect(handleTranscribeJob(uploadId)).rejects.toThrow(
      "transcription failed",
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});
