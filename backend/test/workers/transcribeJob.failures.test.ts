import { beforeEach, describe, expect, it, vi } from "vitest";

const audioUploadId = "550e8400-e29b-41d4-a716-446655440000";
const claimToken = "7d0f1a52-5c4b-4f4e-9d4a-2f1d5f9f3c11";

const mocks = vi.hoisted(() => ({
  claimAudioJob: vi.fn(),
  unclaimAndResetAudioJob: vi.fn(),
  failAudioJob: vi.fn(),
  saveCompletedTranscript: vi.fn(),
  transcribeAI: vi.fn(),
  signUrl: vi.fn(),
  publish: vi.fn(),
  cleanupTerminalCaptionUpload: vi.fn(),
}));

vi.mock("../../shared/data", () => ({
  data: {
    jobs: {
      claimAudioJob: mocks.claimAudioJob,
      unclaimAndResetAudioJob: mocks.unclaimAndResetAudioJob,
      failAudioJob: mocks.failAudioJob,
    },
    transcripts: { saveCompletedTranscript: mocks.saveCompletedTranscript },
  },
}));

vi.mock("../../shared/ai/ai_transcribe_client", () => ({
  DEFAULT_TRANSCRIBE_MODEL: "nova-3-general",
  transcribeAI: mocks.transcribeAI,
}));

vi.mock("../../shared/storage/bucket", () => ({
  bucket: { getText: vi.fn() },
}));
vi.mock("../../shared/storage/sign", () => ({ sign: { url: mocks.signUrl } }));

vi.mock("../../shared/captionUploads", () => ({
  cleanupTerminalCaptionUpload: mocks.cleanupTerminalCaptionUpload,
}));

vi.mock("../../shared/message-queue/messageQueue", async (importActual) => ({
  ...(await importActual<
    typeof import("../../shared/message-queue/messageQueue")
  >()),
  mq: {
    queues: { TRANSCRIBE_DONE: "transcribe_done" },
    publish: mocks.publish,
  },
}));

import { handleTranscribeJob } from "../../transcribe-worker/transcribeJob";
import { DeadLetterError } from "../../shared/message-queue/messageQueue";

const audioInput = { audioUploadId } as const;
const firstAttempt = { attempt: 1, lastAttempt: false, redelivered: false };
const lastAttempt = { attempt: 2, lastAttempt: true, redelivered: false };

describe("handleTranscribeJob failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimAudioJob.mockResolvedValue({
      audioUploadId,
      captionUploadId: null,
      transcriptModelId: null,
      userId: "user_01",
      claimToken,
    });
    mocks.signUrl.mockResolvedValue("https://signed.example/audio");
    mocks.transcribeAI.mockRejectedValue(new Error("Deepgram unavailable"));
    mocks.unclaimAndResetAudioJob.mockResolvedValue(true);
    mocks.failAudioJob.mockResolvedValue(undefined);
    mocks.cleanupTerminalCaptionUpload.mockResolvedValue(false);
  });

  describe("before the last attempt", () => {
    it("unclaims and resets the job and rethrows, so the next attempt can claim it", async () => {
      await expect(
        handleTranscribeJob(audioInput, firstAttempt, "audio"),
      ).rejects.toThrow("Deepgram unavailable");

      expect(mocks.unclaimAndResetAudioJob).toHaveBeenCalledWith(
        audioUploadId,
        claimToken,
      );
      expect(mocks.failAudioJob).not.toHaveBeenCalled();
    });

    it("dead-letters the message when the unclaim and reset fails too", async () => {
      const unclaimError = new Error("database unavailable");
      mocks.unclaimAndResetAudioJob.mockRejectedValue(unclaimError);

      const failure = await handleTranscribeJob(
        audioInput,
        firstAttempt,
        "audio",
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(DeadLetterError);
      expect((failure as DeadLetterError).cause).toBe(unclaimError);
      expect(mocks.failAudioJob).not.toHaveBeenCalled();
    });

    it("finishes the message when the job is no longer this worker's", async () => {
      mocks.unclaimAndResetAudioJob.mockResolvedValue(false);

      await expect(
        handleTranscribeJob(audioInput, firstAttempt, "audio"),
      ).resolves.toBeUndefined();
    });

    it("leaves a failed claim to the consumer, touching no job", async () => {
      mocks.claimAudioJob.mockRejectedValue(new Error("database unavailable"));

      await expect(
        handleTranscribeJob(audioInput, firstAttempt, "audio"),
      ).rejects.toThrow("database unavailable");

      expect(mocks.unclaimAndResetAudioJob).not.toHaveBeenCalled();
      expect(mocks.failAudioJob).not.toHaveBeenCalled();
    });

    it("finishes the message when only the completion notice fails", async () => {
      mocks.transcribeAI.mockResolvedValue("a transcript");
      mocks.saveCompletedTranscript.mockResolvedValue(true);
      mocks.publish.mockRejectedValue(new Error("broker unavailable"));
      // The job is completed, so there is no processing claim to hand back.
      mocks.unclaimAndResetAudioJob.mockResolvedValue(false);

      await expect(
        handleTranscribeJob(audioInput, firstAttempt, "audio"),
      ).resolves.toBeUndefined();
    });
  });

  describe("on the last attempt", () => {
    it("fails the job for good and finishes the message", async () => {
      await expect(
        handleTranscribeJob(audioInput, lastAttempt, "audio"),
      ).resolves.toBeUndefined();

      expect(mocks.failAudioJob).toHaveBeenCalledWith(
        audioUploadId,
        claimToken,
      );
      expect(mocks.unclaimAndResetAudioJob).not.toHaveBeenCalled();
    });

    it("leaves the message to be dead-lettered when failing the job fails", async () => {
      mocks.failAudioJob.mockRejectedValue(new Error("database unavailable"));

      await expect(
        handleTranscribeJob(audioInput, lastAttempt, "audio"),
      ).rejects.toThrow("database unavailable");
    });
  });
});
