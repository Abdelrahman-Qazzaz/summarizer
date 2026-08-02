import type { UploadId } from "../../../shared/types/mq.types";
import {
  claimAudioJob,
  completeAudioJob,
  failAudioJob,
  setTranscriptUploadId,
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

    // The audio occupies this job's own uploadId, so the transcript needs a key
    // of its own. A re-run reuses the key it already has and overwrites the
    // object — hence the upsert. Minting a fresh id per run would instead leave
    // the previous transcript orphaned in the bucket.
    const transcriptUploadId: UploadId =
      (job.transcriptUploadId as UploadId | null) ?? randomUUID();
    await uploadTextToBucket(job.userId, transcriptUploadId, transcript, {
      upsert: true,
    });
    await setTranscriptUploadId(uploadId, transcriptUploadId);

    await completeAudioJob(uploadId);
    await mq.sendEvent(mq.queues.TRANSCRIBE_DONE, {
      uploadId,
      userId: job.userId,
    });
  } catch (err) {
    log.error("Transcription job failed", err, { uploadId });
    await failAudioJob(uploadId);

    throw err;
  }
}
