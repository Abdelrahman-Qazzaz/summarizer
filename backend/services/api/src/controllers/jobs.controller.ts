import type { Context } from "hono";
import { CTX_KEYS } from "../../../../shared/keys";
import {
  jobCursorSchema,
  type JobStatus,
  type JobKind,
} from "../schema/jobs.schema";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import { deleteFileFromBucket, readTextFile } from "../../../../shared/bucket";
import { mq } from "../../../../shared/message-queue/messageQueue";
import type { UploadId } from "../../../../shared/types/mq.types";
import { logger } from "../../../../shared/logger";
import { tryCatch } from "../../../../shared/try-catch";
import {
  deleteAudioJob,
  deleteTextJob,
  findAudioChildTextJob,
  findAudioChildTextUploadId,
  findAudioJob,
  findTextJob,
  findUserJobsPage,
  requeueAudioJob,
  requeueTextJob,
} from "../../../../shared/data/jobs.data";

const log = logger.child({ controller: "jobs" });

export async function handleGetSummarizeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  const textJob = await findTextJob(userId, uploadId);

  if (textJob)
    return c.json({
      kind: "text" as const,
      uploadId: textJob.uploadId,
      fileName: textJob.fileName,
      status: textJob.status,
      summary: textJob.summary,
      error: textJob.error,
    });

  return c.json({ message: "Job not found" }, 404);
}

export async function handleGetTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  // The audio row and its child text row are independent lookups.
  const [audioJob, textJob] = await Promise.all([
    findAudioJob(userId, uploadId),
    findAudioChildTextJob(userId, uploadId),
  ]);

  if (audioJob) {
    // The transcript text isn't stored on the audio row — it lives in the
    // bucket as the child text job's source file (keyed by that job's id).
    // Read it back so the client can display the transcript, not just the
    // downstream summary.
    // Only read once transcription has completed. During a re-run the audio row
    // is reset to "queued" while the previous text row/file still exist, so an
    // ungated read would return a stale transcript (and download it needlessly).
    let transcript: string | null = null;
    if (textJob && audioJob.status === "completed") {
      const { data, error } = await tryCatch(
        readTextFile(userId, textJob.uploadId as UploadId),
      );
      // Fall back to no transcript (data is null on failure), but log it —
      // otherwise a real bucket failure is indistinguishable from "transcript
      // not ready yet".
      if (error)
        log.error("Failed to read transcript from bucket", error, {
          uploadId,
          textUploadId: textJob.uploadId,
        });
      transcript = data;
    }
    return c.json({
      kind: "audio" as const,
      uploadId: audioJob.uploadId,
      fileName: audioJob.fileName,
      status: audioJob.status,
      transcript,
      summary: textJob ? textJob.summary : null,
      // Status of the downstream summarization step, which runs as a separate
      // job after transcription completes. Without this a failed summary is
      // invisible: the audio row stays "completed" and its `error` is null.
      summaryStatus: textJob ? textJob.status : null,
      error: audioJob.error,
    });
  }

  return c.json({ message: "Job not found" }, 404);
}

const DEFAULT_PAGE_SIZE = 20;

export async function getUserJobs(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const limit: number = c.get("limit") ?? DEFAULT_PAGE_SIZE;
  const rawCursor: string | undefined = c.get(CTX_KEYS.cursor);
  const status: JobStatus | undefined = c.get(CTX_KEYS.status);
  const kind: JobKind | undefined = c.get(CTX_KEYS.kind);
  const searchQuery: string | undefined = c.get(CTX_KEYS.q);

  // A malformed/forged cursor decodes to null → fall back to the first page.
  const cursor = rawCursor ? decodeCursor(rawCursor, jobCursorSchema) : null;

  const merged = await findUserJobsPage({
    userId,
    status,
    searchQuery,
    cursor,
    // Over-fetch one extra per table so we can tell whether another page exists.
    fetchCount: limit + 1,
  });

  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
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

  // Look up the child transcript row before deleting the audio job: the FK
  // cascade removes the row, but its bucket file (keyed by the text job's id,
  // not the audio id) would otherwise be orphaned in storage.
  const child = await findAudioChildTextUploadId(userId, uploadId);

  // Row delete and bucket deletes are independent: the bucket keys are
  // user-scoped (<userId>/<uploadId>), so a non-owner's request no-ops on
  // storage structurally — no ownership gate needed between them.
  await Promise.all([
    deleteAudioJob(userId, uploadId),
    deleteFileFromBucket(userId, uploadId),
    ...(child
      ? [deleteFileFromBucket(userId, child.uploadId as UploadId)]
      : []),
  ]);
  return c.json({ message: "Job Deleted" }, 200);
}

export async function handleDeleteSummarizeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  // Independent user-scoped operations (see handleDeleteTranscribeJob).
  await Promise.all([
    deleteTextJob(userId, uploadId),
    deleteFileFromBucket(userId, uploadId),
  ]);
  return c.json({ message: "Job Deleted" }, 200);
}

/**
 * Re-summarize a directly-uploaded text job with a different model. Resets the
 * row to `queued` (clearing the old summary/error) and re-enqueues it.
 */
export async function handleRerunSummarizeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);
  const chosenModelId = c.get(CTX_KEYS.chosenModelId);

  const job = await requeueTextJob(userId, uploadId, chosenModelId);

  if (!job) return c.json({ message: "Job not found" }, 404);

  await mq.sendEvent(mq.queues.SUMMARIZE, uploadId);
  return c.json({ uploadId });
}

/**
 * Re-run an audio job end to end: transcribe again with a new transcription
 * model and re-summarize the fresh transcript with a new summary model. Resets
 * the audio job to `queued` and re-enqueues TRANSCRIBE; the worker reuses the
 * existing child summary row and propagates the new summary model to it.
 * Returns the audio id the client tracks.
 */
export async function handleRerunTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);
  const transcriptionModelId = c.get(CTX_KEYS.transcriptionModelId);
  const chosenModelId = c.get(CTX_KEYS.chosenModelId);

  const job = await requeueAudioJob(userId, uploadId, {
    transcriptionModelId,
    chosenModelId,
  });

  if (!job) return c.json({ message: "Job not found" }, 404);

  await mq.sendEvent(mq.queues.TRANSCRIBE, uploadId);
  return c.json({ uploadId });
}
