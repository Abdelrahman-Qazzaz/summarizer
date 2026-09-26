import {
  DEFAULT_TRANSCRIBE_MODEL,
  transcribeAI,
} from "../shared/ai/ai_transcribe_client";
import { sign } from "../shared/storage/sign";
import { data } from "../shared/data";
import { logger } from "../shared/logger";
import {
  DeadLetterError,
  mq,
  type DeliveryMetadata,
} from "../shared/message-queue/messageQueue";
import type { UploadId } from "../shared/types";

const log = logger.child({ component: "transcribe-worker" });

type ClaimedJob = NonNullable<
  Awaited<ReturnType<typeof data.jobs.claimAudioJob>>
>;

/** The job's audio, transcribed. */
async function transcribeAudio(job: ClaimedJob) {
  const audioUrl = await sign.url(job.userId, {
    kind: "audio",
    uploadId: job.audioUploadId,
  });
  return transcribeAI(
    job.transcriptModelId ?? DEFAULT_TRANSCRIBE_MODEL,
    audioUrl,
  );
}

/**
 * What becomes of a job this worker claimed and then failed on.
 *
 * Before the last attempt the claim is handed back and the error rethrown, so
 * the next attempt claims a queued job. If handing it back fails too, the
 * database most likely failed both times, so the message is dead-lettered
 * rather than tried again in the same outage.
 *
 * On the last attempt the job fails for good. The job row records that, so
 * the message is done.
 */
async function settleFailedJob(
  audioUploadId: UploadId,
  claimToken: string,
  lastAttempt: boolean,
  error: unknown,
) {
  if (lastAttempt) {
    await data.jobs.failAudioJob(audioUploadId, claimToken);
    return;
  }

  let unclaimed: boolean;
  try {
    unclaimed = await data.jobs.unclaimAndResetAudioJob(
      audioUploadId,
      claimToken,
    );
  } catch (unclaimError) {
    throw new DeadLetterError(
      "Could not unclaim and reset the job after it failed; it is left processing, " +
        "so reset it to queued with no claim token before replaying this",
      { cause: unclaimError },
    );
  }
  // Completed, deleted or claimed by another worker: nothing to try again.
  if (!unclaimed) return;
  throw error;
}

/**
 * Stores a job's transcript: the video's captions when the message carries
 * them (caption_transcript), otherwise its audio transcribed (transcribe).
 */
export async function handleTranscribeJob(
  {
    audioUploadId,
    transcript: captions,
  }: {
    audioUploadId: UploadId;
    transcript?: string;
  },
  { attempt, lastAttempt, redelivered }: DeliveryMetadata,
) {
  let claimToken: string | null = null;

  try {
    const job = await data.jobs.claimAudioJob(audioUploadId, redelivered);
    if (!job) return;
    claimToken = job.claimToken;

    const transcript = captions ?? (await transcribeAudio(job));
    if (!transcript.trim()) throw new Error("Transcription produced no text");

    log.debug("Transcription produced", {
      audioUploadId,
      length: transcript.length,
    });

    const saved = await data.transcripts.saveCompletedTranscript(
      audioUploadId,
      transcript,
      claimToken,
    );
    if (!saved) {
      log.debug("Discarded result from superseded claim", { audioUploadId });
      return;
    }

    await mq.publish(mq.queues.TRANSCRIBE_DONE, {
      audioUploadId,
      userId: job.userId,
    });
  } catch (error) {
    log.error("Transcription job failed", error, {
      audioUploadId,
      attempt,
      redelivered,
    });
    // Nothing claimed: the consumer tries again or dead-letters it.
    if (!claimToken) throw error;
    await settleFailedJob(audioUploadId, claimToken, lastAttempt, error);
  }
}
