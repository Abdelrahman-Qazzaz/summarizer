import {
  DEFAULT_TRANSCRIBE_MODEL,
  transcribeAI,
} from "../shared/ai/ai_transcribe_client";
import { bucket } from "../shared/bucket";
import { cleanupTerminalCaptionUpload } from "../shared/captionUploads";
import { data } from "../shared/data";
import { logger, messageOf } from "../shared/logger";
import {
  mq,
  type DeliveryMetadata,
} from "../shared/message-queue/messageQueue";
import type { UploadId } from "../shared/types";

const log = logger.child({ component: "transcribe-worker" });

type HandleTranscribeJobInput = {
  audioUploadId: UploadId;
  useCaptionUpload: boolean;
};

type AudioJob = Awaited<ReturnType<typeof data.jobs.claimAudioJob>> & {};

async function runTranscriptionJob(
  audioUploadId: UploadId,
  redelivered: boolean,
  getTranscript: (job: NonNullable<AudioJob>) => Promise<string>,
): Promise<void> {
  let claimToken: string | null = null;

  try {
    const job = await data.jobs.claimAudioJob(audioUploadId, redelivered);
    if (!job) return;
    claimToken = job.claimToken;

    const transcript = await getTranscript(job);
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
    log.error("Transcription job failed", error, { audioUploadId });
    if (claimToken) await data.jobs.failAudioJob(audioUploadId, claimToken);
    throw error;
  }
}

export async function handleTranscribeJob(
  { audioUploadId, useCaptionUpload }: HandleTranscribeJobInput,
  deliveryMetadata: DeliveryMetadata = { redelivered: false },
) {
  const { redelivered } = deliveryMetadata;

  try {
    await runTranscriptionJob(audioUploadId, redelivered, async (job) => {
      if (useCaptionUpload) {
        if (!job.captionUploadId) {
          throw new Error(
            "Caption upload is missing from the transcription job",
          );
        }
        return bucket.getText(job.userId, job.captionUploadId);
      }

      const audioUrl = await bucket.createSignedUrl(job.userId, {
        kind: "audio",
        uploadId: audioUploadId,
      });
      const model = job.transcriptModelId ?? DEFAULT_TRANSCRIBE_MODEL;
      return transcribeAI(model, audioUrl);
    });
  } finally {
    try {
      await cleanupTerminalCaptionUpload(audioUploadId);
    } catch (error) {
      log.warn("Failed to clean up caption upload", {
        audioUploadId,
        error: messageOf(error),
      });
    }
  }
}
