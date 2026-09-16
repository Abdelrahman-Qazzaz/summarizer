import { createAudioJob } from "./data/jobs.data";
import { mq } from "./message-queue/messageQueue";
import type { UploadId } from "./types";

/**
 * Records an uploaded audio file as a transcription job and hands it to the
 * worker. Returns false, queueing nothing, when the job already exists.
 *
 * The two steps are not atomic: a publish that fails leaves a queued row that
 * nothing will pick up. Keeping them behind one call is what lets that be
 * fixed in one place rather than in every route that starts a transcription.
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
  const created = await createAudioJob({ ...job, captionUploadId: null });
  if (!created) return false;

  await mq.publish(mq.queues.TRANSCRIBE, { audioUploadId: job.audioUploadId });
  return true;
}
