import type { UploadId } from "../../../shared/types/mq.types";
import {
  db,
  AudioTranscriptionJobs,
  TextSummarizationJobs,
} from "../../../shared/db";
import { and, eq } from "drizzle-orm";
import { getAudioFile, uploadTextToBucket } from "../../../shared/bucket";
import { transcribe } from "../../../shared/ai/transcribe";
import { mq } from "../../../shared/message-queue/messageQueue";
import { randomUUID } from "crypto";
import { DEFAULT_MODELS } from "../../../shared/ai/ai_client";
import { logger } from "../../../shared/logger";

const log = logger.child({ worker: "transcribe" });

export async function handleTranscribeJob(uploadId: UploadId) {
  const TABLE = AudioTranscriptionJobs;
  try {
    const [job] = await db
      .update(TABLE)
      .set({ status: "processing" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "queued")))
      .returning();

    if (!job) return;

    const audio = await getAudioFile(uploadId);
    const model = job.transcriptionModelId ?? DEFAULT_MODELS.TRANSCRIBE;
    const transcript = await transcribe(model, audio);
    log.debug("Transcription produced", { uploadId, length: transcript.length });
    await db
      .update(TABLE)
      .set({ status: "completed" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    const userId = job.userId;
    const chosenModelId = job.chosenModelId;
    await mq.sendEvent(mq.queues.TRANSCRIBE_DONE, { uploadId, userId });

    const fileName = `${job.fileName}.txt`;
    const sizeBytes = Buffer.byteLength(transcript, "utf8");

    // Re-summarization rides on a child text row linked back via audioUploadId.
    // Reuse it on a re-run (idempotent) instead of inserting a duplicate.
    const [existing] = await db
      .select({ uploadId: TextSummarizationJobs.uploadId })
      .from(TextSummarizationJobs)
      .where(eq(TextSummarizationJobs.audioUploadId, uploadId))
      .limit(1);

    const textUploadId: UploadId =
      (existing?.uploadId as UploadId) ?? randomUUID();
    await uploadTextToBucket(textUploadId, transcript);

    if (existing) {
      // Reset the summary so the new transcript is summarized afresh with the
      // (possibly updated) model carried on the audio job.
      await db
        .update(TextSummarizationJobs)
        .set({ status: "queued", summary: null, error: null, sizeBytes, chosenModelId })
        .where(eq(TextSummarizationJobs.uploadId, textUploadId));
    } else {
      await db.insert(TextSummarizationJobs).values({
        uploadId: textUploadId,
        userId,
        fileName,
        sizeBytes,
        chosenModelId,
        audioUploadId: uploadId,
      });
    }
    await mq.sendEvent(mq.queues.SUMMARIZE, textUploadId);
  } catch (err) {
    log.error("Transcription job failed", err, { uploadId });
    await db
      .update(TABLE)
      .set({ status: "failed" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    throw err;
  }
}
