import type { Context } from "hono";
import { CTX_KEYS } from "../../../../shared/keys";
import { jobCursorSchema, type JobStatus } from "../schema/jobs.schema";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import {
  deleteFilesFromBucket,
  readTextFile,
} from "../../../../shared/bucket";
import { mq } from "../../../../shared/message-queue/messageQueue";
import type { UploadId } from "../../../../shared/types/mq.types";
import { logger } from "../../../../shared/logger";
import { tryCatch } from "../../../../shared/try-catch";
import {
  deleteAudioJob,
  findAudioJob,
  findUserJobsPage,
  requeueAudioJob,
} from "../../../../shared/data/jobs.data";

const log = logger.child({ controller: "jobs" });

export async function handleGetTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  const audioJob = await findAudioJob(userId, uploadId);

  if (!audioJob) return c.json({ message: "Job not found" }, 404);

  // The transcript isn't stored on the row — it lives in the bucket under its
  // own key. Only read once transcription has completed: during a re-run the
  // row is reset to "queued" while the previous transcript is still in storage,
  // so an ungated read would return a stale one (and download it needlessly).
  let transcript: string | null = null;
  if (audioJob.transcriptUploadId && audioJob.status === "completed") {
    const { data, error } = await tryCatch(
      readTextFile(userId, audioJob.transcriptUploadId as UploadId),
    );
    // Fall back to no transcript (data is null on failure), but log it —
    // otherwise a real bucket failure is indistinguishable from "transcript
    // not ready yet".
    if (error)
      log.error("Failed to read transcript from bucket", error, {
        uploadId,
        transcriptUploadId: audioJob.transcriptUploadId,
      });
    transcript = data;
  }

  return c.json({
    uploadId: audioJob.uploadId,
    fileName: audioJob.fileName,
    status: audioJob.status,
    transcript,
    error: audioJob.error,
  });
}

const DEFAULT_PAGE_SIZE = 20;

export async function getUserJobs(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const limit: number = c.get("limit") ?? DEFAULT_PAGE_SIZE;
  const rawCursor: string | undefined = c.get(CTX_KEYS.cursor);
  const status: JobStatus | undefined = c.get(CTX_KEYS.status);
  const searchQuery: string | undefined = c.get(CTX_KEYS.q);

  // A malformed/forged cursor decodes to null → fall back to the first page.
  const cursor = rawCursor ? decodeCursor(rawCursor, jobCursorSchema) : null;

  const rows = await findUserJobsPage({
    userId,
    status,
    searchQuery,
    cursor,
    // Over-fetch one so we can tell whether another page exists.
    fetchCount: limit + 1,
  });

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, uploadId: last.uploadId })
      : null;

  return c.json({ jobs: page, nextCursor });
}

export async function handleDeleteTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  // Read the transcript key before the row goes: it is keyed independently of
  // the audio, so deleting the row alone would orphan it in storage.
  const job = await findAudioJob(userId, uploadId);

  // Row delete and bucket deletes are independent: the bucket keys are
  // user-scoped (<userId>/<uploadId>), so a non-owner's request no-ops on
  // storage structurally — no ownership gate needed between them.
  await Promise.all([
    deleteAudioJob(userId, uploadId),
    deleteFilesFromBucket(userId, [
      uploadId,
      ...(job?.transcriptUploadId ? [job.transcriptUploadId] : []),
    ]),
  ]);
  return c.json({ message: "Job Deleted" }, 200);
}

/**
 * Re-run an audio job: transcribe again with a new transcription model. Resets
 * the row to `queued` and re-enqueues TRANSCRIBE; the worker overwrites the
 * transcript already in the bucket.
 */
export async function handleRerunTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);
  const transcriptionModelId = c.get(CTX_KEYS.transcriptionModelId);

  const job = await requeueAudioJob(userId, uploadId, transcriptionModelId);

  if (!job) return c.json({ message: "Job not found" }, 404);

  await mq.sendEvent(mq.queues.TRANSCRIBE, uploadId);
  return c.json({ uploadId });
}
