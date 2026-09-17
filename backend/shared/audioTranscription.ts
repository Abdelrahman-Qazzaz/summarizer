import { createAudioJob } from "./data/jobs.data";
import { mq } from "./message-queue/messageQueue";
import type { UploadId } from "./types";
import { confirmCheckedUpload } from "./uploads";

/**
 * Confirms an uploaded audio file as a transcription job and hands it to the
 * worker. The job's rows are written in the transaction that confirms the
 * upload, so returns false, queueing nothing, when another confirm got there
 * first.
 *
 * The publish is not part of that transaction: a publish that fails leaves a
 * queued row that nothing will pick up.
 */
export async function queueAudioTranscription(job: {
  audioUploadId: UploadId;
  userId: string;
  source: "audio" | "video";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  transcriptModelId: string;
}) {
  const confirmed = await confirmCheckedUpload(
    job.userId,
    { kind: "audio", uploadId: job.audioUploadId },
    (executor) => createAudioJob({ ...job, captionUploadId: null }, executor),
  );
  if (!confirmed) return false;

  await mq.publish(mq.queues.TRANSCRIBE, { audioUploadId: job.audioUploadId });
  return true;
}
