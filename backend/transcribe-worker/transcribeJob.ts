import {
  DEFAULT_TRANSCRIBE_MODEL,
  transcribeAI,
} from "../shared/ai/ai_transcribe_client";
import { generateTitle } from "../shared/ai/ai_chat_client";
import {
  AUDIO_URL_TTL_SECONDS,
  createSignedUrl,
  getTextFromBucket,
} from "../shared/bucket";
import { claimAudioJob, failAudioJob } from "../shared/data/jobs.data";
import { saveCompletedTranscript } from "../shared/data/transcripts.data";
import { logger } from "../shared/logger";
import {
  mq,
  type DeliveryMetadata,
} from "../shared/message-queue/messageQueue";
import type { UploadId } from "../shared/types";

const log = logger.child({ component: "transcribe-worker" });

type handleTranscribeJobInput =
  | { uploadId: UploadId | null; existingTranscriptId: UploadId }
  | { uploadId: UploadId; existingTranscriptId: UploadId | null };

type AudioJob = Awaited<ReturnType<typeof claimAudioJob>> & {};

async function resolveTitle(
  transcript: string,
  fallback: string,
  uploadId: string,
): Promise<string> {
  try {
    return await generateTitle("transcript", transcript);
  } catch (error) {
    log.warn("Transcript title generation failed", {
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

async function runTranscriptionJob(
  uploadId: UploadId,
  redelivered: boolean,
  getTranscript: (job: NonNullable<AudioJob>) => Promise<string>,
): Promise<void> {
  let claimToken: string | null = null;

  try {
    const job = await claimAudioJob(uploadId, redelivered);
    if (!job) return;
    claimToken = job.claimToken;

    const transcript = await getTranscript(job);
    if (!transcript.trim()) throw new Error("Transcription produced no text");

    log.debug("Transcription produced", {
      uploadId,
      length: transcript.length,
    });

    const title = await resolveTitle(transcript, job.fileName, uploadId);

    const saved = await saveCompletedTranscript(
      job.userId,
      uploadId,
      transcript,
      title,
      claimToken,
    );
    if (!saved) {
      log.debug("Discarded result from superseded claim", { uploadId });
      return;
    }

    await mq.publish(mq.queues.TRANSCRIBE_DONE, {
      uploadId,
      userId: job.userId,
    });
  } catch (error) {
    log.error("Transcription job failed", error, { uploadId });
    if (claimToken) await failAudioJob(uploadId, claimToken);
    throw error;
  }
}

export async function handleTranscribeJob(
  { uploadId, existingTranscriptId }: handleTranscribeJobInput,
  deliveryMetadata: DeliveryMetadata = { redelivered: false },
) {
  const { redelivered } = deliveryMetadata;

  if (uploadId) {
    await runTranscriptionJob(uploadId, redelivered, async (job) => {
      const audioUrl = await createSignedUrl(
        job.userId,
        uploadId,
        AUDIO_URL_TTL_SECONDS,
      );
      const model = job.transcriptModelId ?? DEFAULT_TRANSCRIBE_MODEL;
      return transcribeAI(model, audioUrl);
    });
  } else if (existingTranscriptId) {
    await runTranscriptionJob(existingTranscriptId, redelivered, (job) =>
      getTextFromBucket(job.userId, existingTranscriptId),
    );
  }
}
