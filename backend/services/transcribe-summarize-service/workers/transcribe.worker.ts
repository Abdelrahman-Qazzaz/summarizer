import type { UploadId } from "../../../shared/types/mq.types";
import {
  claimAudioJob,
  completeAudioJob,
  createTextJob,
  failAudioJob,
  findTextJobByAudioUploadId,
  requeueChildTextJob,
} from "../../../shared/data/jobs.data";
import { getAudioFile, uploadTextToBucket } from "../../../shared/bucket";
import { transcribe } from "../../../shared/ai/transcribe";
import { mq } from "../../../shared/message-queue/messageQueue";
import { randomUUID } from "crypto";
import { DEFAULT_MODELS } from "../../../shared/ai/ai_client";
import { logger } from "../../../shared/logger";

const log = logger.child({ worker: "transcribe" });

export async function handleTranscribeJob(uploadId: UploadId) {
  try {
    const job = await claimAudioJob(uploadId);

    if (!job) return;

    const audio = await getAudioFile(job.userId, uploadId);
    const model = job.transcriptionModelId ?? DEFAULT_MODELS.TRANSCRIBE;
    const transcript = await transcribe(model, audio);
    if (!transcript.trim()) {
      throw new Error("Transcription produced no text");
    }
    log.debug("Transcription produced", {
      uploadId,
      length: transcript.length,
    });
    await completeAudioJob(uploadId);

    const userId = job.userId;
    const chosenModelId = job.chosenModelId;
    await mq.sendEvent(mq.queues.TRANSCRIBE_DONE, { uploadId, userId });

    const fileName = `${job.fileName}.txt`;
    const sizeBytes = Buffer.byteLength(transcript, "utf8");

    // Re-summarization rides on a child text row linked back via audioUploadId.
    // Reuse it on a re-run (idempotent) instead of inserting a duplicate.
    const existing = await findTextJobByAudioUploadId(uploadId);

    const textUploadId: UploadId =
      (existing?.uploadId as UploadId) ?? randomUUID();
    await uploadTextToBucket(userId, textUploadId, transcript);

    if (existing) {
      // Reset the summary so the new transcript is summarized afresh with the
      // (possibly updated) model carried on the audio job.
      await requeueChildTextJob(textUploadId, { sizeBytes, chosenModelId });
    } else {
      await createTextJob({
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
    await failAudioJob(uploadId);

    throw err;
  }
}
