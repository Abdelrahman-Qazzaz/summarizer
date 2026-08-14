import type { Context } from "hono";
import { CTX_KEYS } from "../../../shared/keys";
import { jobCursorSchema, type JobStatus } from "../schema/jobs.schema";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import { mq } from "../../../shared/message-queue/messageQueue";
import {
  deleteAudioJob,
  findAudioJob,
  findUserJobsPage,
  requeueAudioJob,
} from "../../../shared/data/jobs.data";
import {
  deleteTranscript,
  findTranscript,
} from "../../../shared/data/transcripts.data";
import { tryCatch } from "../../../shared/try-catch";
import { logger } from "../../../shared/logger";

const log = logger.child({ controller: "jobs" });

export async function handleGetTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  // A transcript row exists only for a completed job (a re-run drops it), so its
  // presence is enough — no status gate, and it's the user's own by the scope.
  // A transcript-read failure degrades to null rather than failing the job view.
  const [audioJob, transcriptResult] = await Promise.all([
    findAudioJob(userId, uploadId),
    tryCatch(findTranscript(userId, uploadId)),
  ]);

  if (!audioJob) return c.json({ message: "Job not found" }, 404);

  if (transcriptResult.error)
    log.error("Failed to read transcript for job view", transcriptResult.error, {
      uploadId,
    });

  return c.json({
    uploadId: audioJob.uploadId,
    fileName: audioJob.fileName,
    status: audioJob.status,
    transcript: transcriptResult.data?.content ?? null,
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

  // The transcript row cascades with the job; only the audio object is left in
  // the bucket to remove. The key is user-scoped (<userId>/<uploadId>), so a
  // non-owner's request no-ops on storage structurally.
  await Promise.all([
    deleteAudioJob(userId, uploadId),
    deleteFilesFromBucket(userId, [uploadId]),
  ]);
  return c.json({ message: "Job Deleted" }, 200);
}

/**
 * Re-run an audio job: transcribe again with a new transcription model. Resets
 * the row to `queued`, drops the old transcript so it isn't read mid-run, and
 * re-enqueues TRANSCRIBE; the worker writes the fresh transcript on completion.
 */
export async function handleRerunTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);
  const transcriptionModelId = c.get(CTX_KEYS.transcriptionModelId);

  const job = await requeueAudioJob(userId, uploadId, transcriptionModelId);

  if (!job) return c.json({ message: "Job not found" }, 404);

  await deleteTranscript(uploadId);
  await mq.publish(mq.queues.TRANSCRIBE, { uploadId });
  return c.json({ uploadId });
}
