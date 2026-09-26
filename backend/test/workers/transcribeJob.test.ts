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

vi.mock("../../shared/storage/sign", () => ({ sign: { url: mocks.signUrl } }));

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

describe("handleTranscribeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimAudioJob.mockResolvedValue({
      audioUploadId,
      transcriptModelId: null,
      userId: "user_01",
      claimToken,
    });
    mocks.signUrl.mockResolvedValue("https://signed.example/audio");
    mocks.transcribeAI.mockRejectedValue(new Error("Deepgram unavailable"));
    mocks.unclaimAndResetAudioJob.mockResolvedValue(true);
    mocks.failAudioJob.mockResolvedValue(undefined);
  });

  describe("storing a transcript", () => {
    beforeEach(() => {
      mocks.transcribeAI.mockResolvedValue("the audio, transcribed");
      mocks.saveCompletedTranscript.mockResolvedValue(true);
      mocks.publish.mockResolvedValue(undefined);
    });

    it("stores the captions the message carries, without transcribing audio", async () => {
      await handleTranscribeJob(
        { audioUploadId, transcript: "the captions" },
        firstAttempt,
      );

      expect(mocks.signUrl).not.toHaveBeenCalled();
      expect(mocks.transcribeAI).not.toHaveBeenCalled();
      expect(mocks.saveCompletedTranscript).toHaveBeenCalledWith(
        audioUploadId,
        "the captions",
        claimToken,
      );
    });

    it("transcribes the audio when the message carries no captions", async () => {
      await handleTranscribeJob(audioInput, firstAttempt);

      expect(mocks.signUrl).toHaveBeenCalledWith("user_01", {
        kind: "audio",
        uploadId: audioUploadId,
      });
      expect(mocks.transcribeAI).toHaveBeenCalledWith(
        "nova-3-general",
        "https://signed.example/audio",
      );
      expect(mocks.saveCompletedTranscript).toHaveBeenCalledWith(
        audioUploadId,
        "the audio, transcribed",
        claimToken,
      );
    });

    it("announces the finished job to the API", async () => {
      await handleTranscribeJob(audioInput, firstAttempt);

      expect(mocks.publish).toHaveBeenCalledWith("transcribe_done", {
        audioUploadId,
        userId: "user_01",
      });
    });

    it("does nothing when there is no queued job to claim", async () => {
      mocks.claimAudioJob.mockResolvedValue(null);

      await handleTranscribeJob(audioInput, firstAttempt);

      expect(mocks.transcribeAI).not.toHaveBeenCalled();
      expect(mocks.saveCompletedTranscript).not.toHaveBeenCalled();
      expect(mocks.publish).not.toHaveBeenCalled();
    });

    it("announces nothing after losing its claim to another worker", async () => {
      mocks.saveCompletedTranscript.mockResolvedValue(false);

      await handleTranscribeJob(audioInput, firstAttempt);

      expect(mocks.publish).not.toHaveBeenCalled();
    });

    it("may reclaim a processing job only when the broker redelivered it", async () => {
      await handleTranscribeJob(audioInput, firstAttempt);
      await handleTranscribeJob(audioInput, {
        ...firstAttempt,
        redelivered: true,
      });

      expect(mocks.claimAudioJob.mock.calls).toEqual([
        [audioUploadId, false],
        [audioUploadId, true],
      ]);
    });
  });

  describe("before the last attempt", () => {
    it("treats an empty transcript as a failure", async () => {
      mocks.transcribeAI.mockResolvedValue("   ");

      await expect(
        handleTranscribeJob(audioInput, firstAttempt),
      ).rejects.toThrow("No speech found in the audio");

      expect(mocks.saveCompletedTranscript).not.toHaveBeenCalled();
      expect(mocks.unclaimAndResetAudioJob).toHaveBeenCalled();
    });

    it("unclaims and resets the job and rethrows, so the next attempt can claim it", async () => {
      await expect(
        handleTranscribeJob(audioInput, firstAttempt),
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

      const failure = await handleTranscribeJob(audioInput, firstAttempt).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(DeadLetterError);
      expect((failure as DeadLetterError).cause).toBe(unclaimError);
      expect(mocks.failAudioJob).not.toHaveBeenCalled();
    });

    it("finishes the message when the job is no longer this worker's", async () => {
      mocks.unclaimAndResetAudioJob.mockResolvedValue(false);

      await expect(
        handleTranscribeJob(audioInput, firstAttempt),
      ).resolves.toBeUndefined();
    });

    it("leaves a failed claim to the consumer, touching no job", async () => {
      mocks.claimAudioJob.mockRejectedValue(new Error("database unavailable"));

      await expect(
        handleTranscribeJob(audioInput, firstAttempt),
      ).rejects.toThrow("database unavailable");

      expect(mocks.unclaimAndResetAudioJob).not.toHaveBeenCalled();
      expect(mocks.failAudioJob).not.toHaveBeenCalled();
    });

    // The transcript is saved by then: a lost announcement is not a failed job.
    it("finishes the message when only the completion notice fails", async () => {
      mocks.transcribeAI.mockResolvedValue("a transcript");
      mocks.saveCompletedTranscript.mockResolvedValue(true);
      mocks.publish.mockRejectedValue(new Error("broker unavailable"));

      await expect(
        handleTranscribeJob(audioInput, firstAttempt),
      ).resolves.toBeUndefined();

      expect(mocks.unclaimAndResetAudioJob).not.toHaveBeenCalled();
      expect(mocks.failAudioJob).not.toHaveBeenCalled();
    });
  });

  describe("on the last attempt", () => {
    it("fails the job for good and finishes the message", async () => {
      await expect(
        handleTranscribeJob(audioInput, lastAttempt),
      ).resolves.toBeUndefined();

      expect(mocks.unclaimAndResetAudioJob).not.toHaveBeenCalled();
    });

    // The reason is shown next to the file's name, so it can't be the raw
    // error ("Deepgram unavailable").
    it("records a general reason for the user", async () => {
      await handleTranscribeJob(audioInput, lastAttempt);

      expect(mocks.failAudioJob).toHaveBeenCalledWith(
        audioUploadId,
        claimToken,
        "Could not be transcribed",
      );
    });

    it("says so when the audio had no speech in it", async () => {
      mocks.transcribeAI.mockResolvedValue("   ");

      await handleTranscribeJob(audioInput, lastAttempt);

      expect(mocks.failAudioJob).toHaveBeenCalledWith(
        audioUploadId,
        claimToken,
        "No speech found in the audio",
      );
    });

    it("leaves the message to be dead-lettered when failing the job fails", async () => {
      mocks.failAudioJob.mockRejectedValue(new Error("database unavailable"));

      await expect(
        handleTranscribeJob(audioInput, lastAttempt),
      ).rejects.toThrow("database unavailable");
    });
  });
});
