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

export async function handleTranscribeJob(
  { uploadId, existingTranscriptId }: handleTranscribeJobInput,
  deliveryMetadata: DeliveryMetadata = { redelivered: false },
) {
  // TODO: refactor to remove code dupliation between the two conditionals
  if (uploadId) {
    let claimToken: string | null = null;

    try {
      const job = await claimAudioJob(uploadId, deliveryMetadata.redelivered);

      if (!job) return;
      claimToken = job.claimToken;

      const audioUrl = await createSignedUrl(
        job.userId,
        uploadId,
        AUDIO_URL_TTL_SECONDS,
      );
      const model = job.transcriptModelId ?? DEFAULT_TRANSCRIBE_MODEL;
      const transcript = await transcribeAI(model, audioUrl);
      if (!transcript.trim()) {
        throw new Error("Transcription produced no text");
      }
      log.debug("Transcription produced", {
        uploadId,
        length: transcript.length,
      });

      let title = job.fileName;
      try {
        title = await generateTitle("transcript", transcript);
      } catch (error) {
        log.warn("Transcript title generation failed", {
          uploadId,
          error: error instanceof Error ? error.message : String(error),
        });
        title = job.fileName;
      }

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
  } else if (existingTranscriptId) {
    let claimToken: string | null = null;

    try {
      const job = await claimAudioJob(
        existingTranscriptId,
        deliveryMetadata.redelivered,
      );

      if (!job) return;
      claimToken = job.claimToken;

      const transcript = await getTextFromBucket(
        job.userId,
        existingTranscriptId,
      );
      if (!transcript.trim()) {
        throw new Error("Transcription produced no text");
      }
      log.debug("Transcription produced", {
        uploadId: existingTranscriptId,
        length: transcript.length,
      });

      let title = job.fileName;
      try {
        title = await generateTitle("transcript", transcript);
      } catch (error) {
        log.warn("Transcript title generation failed", {
          uploadId: existingTranscriptId,
          error: error instanceof Error ? error.message : String(error),
        });
        title = job.fileName;
      }

      const saved = await saveCompletedTranscript(
        job.userId,
        existingTranscriptId,
        transcript,
        title,
        claimToken,
      );
      if (!saved) {
        log.debug("Discarded result from superseded claim", {
          uploadId: existingTranscriptId,
        });
        return;
      }

      await mq.publish(mq.queues.TRANSCRIBE_DONE, {
        uploadId: existingTranscriptId,
        userId: job.userId,
      });
    } catch (error) {
      log.error("Transcription job failed", error, {
        uploadId: existingTranscriptId,
      });
      if (claimToken) {
        await failAudioJob(existingTranscriptId, claimToken);
      }

      throw error;
    }
  }
}
