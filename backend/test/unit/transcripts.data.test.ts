import { beforeEach, describe, expect, it, vi } from "vitest";

const audioUploadId = "550e8400-e29b-41d4-a716-446655440000";
const claimToken = "8e517c2f-0e16-4a4b-99eb-b3906818b92e";

const {
  mockCompleteAudioJob,
  mockSelect,
  mockInsert,
  mockValues,
  mockTransaction,
  transactionExecutor,
} = vi.hoisted(() => {
  const mockValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const transactionExecutor = { insert: mockInsert };

  return {
    mockCompleteAudioJob: vi.fn(),
    mockSelect: vi.fn(),
    mockInsert,
    mockValues,
    mockTransaction: vi.fn(),
    transactionExecutor,
  };
});

vi.mock("../../shared/db", () => ({
  db: { transaction: mockTransaction, select: mockSelect },
  TranscriptContents: { audioUploadId: "audio_upload_id" },
}));

vi.mock("../../shared/data/jobs.data", () => ({
  completeAudioJob: mockCompleteAudioJob,
}));

import {
  findTranscripts,
  saveCompletedTranscript,
} from "../../shared/data/transcripts.data";

describe("findTranscripts", () => {
  it("returns without querying when no uploads were requested", async () => {
    await expect(findTranscripts("user-1", [])).resolves.toEqual(new Map());
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("saveCompletedTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (callback) =>
      callback(transactionExecutor),
    );
  });

  it("does not write a transcript when the worker lost its claim", async () => {
    mockCompleteAudioJob.mockResolvedValueOnce(false);

    const saved = await saveCompletedTranscript(
      audioUploadId,
      "stale transcript",
      claimToken,
    );

    expect(saved).toBe(false);
    expect(mockCompleteAudioJob).toHaveBeenCalledWith(
      audioUploadId,
      claimToken,
      transactionExecutor,
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("writes the transcript after claiming the terminal transition", async () => {
    mockCompleteAudioJob.mockResolvedValueOnce(true);

    const saved = await saveCompletedTranscript(
      audioUploadId,
      "current transcript",
      claimToken,
    );

    expect(saved).toBe(true);
    expect(mockValues).toHaveBeenCalledWith({
      audioUploadId,
      content: "current transcript",
      charCount: 18,
    });
  });
});
