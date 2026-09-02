import type { Context } from "hono";
import { CTX_KEYS } from "../../../shared/keys";
import { jobCursorSchema, type JobStatus } from "../schema/jobs.schema";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import {
  deleteAudioJob,
  findAudioJob,
  findUserJobsPage,
} from "../../../shared/data/jobs.data";
import { findTranscripts } from "../../../shared/data/transcripts.data";
import { tryCatch } from "../../../shared/try-catch";
import { logger } from "../../../shared/logger";

const log = logger.child({ controller: "jobs" });

export async function handleGetTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId = c.get(CTX_KEYS.audioUploadId);

  // A transcript row exists only for a completed job, so its presence is enough
  // without a separate status check.
  // A transcript-read failure degrades to null rather than failing the job view.
  const [audioJob, transcriptResult] = await Promise.all([
    findAudioJob(userId, audioUploadId),
    tryCatch(findTranscripts(userId, [audioUploadId])),
  ]);

  if (!audioJob) return c.json({ message: "Job not found" }, 404);

  if (transcriptResult.error)
    log.error(
      "Failed to read transcript for job view",
      transcriptResult.error,
      {
        audioUploadId,
      },
    );

  return c.json({
    audioUploadId: audioJob.audioUploadId,
    fileName: audioJob.fileName,
    source: audioJob.source,
    status: audioJob.status,
    transcript: transcriptResult.data?.get(audioUploadId) ?? null,
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
      ? encodeCursor({
          createdAt: last.createdAt,
          audioUploadId: last.audioUploadId,
        })
      : null;

  return c.json({ jobs: page, nextCursor });
}

export async function handleDeleteTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId = c.get(CTX_KEYS.audioUploadId);

  const job = await findAudioJob(userId, audioUploadId);
  if (!job) return c.json({ message: "Job Deleted" }, 200);

  const uploadIds = [
    audioUploadId,
    ...(job.captionUploadId ? [job.captionUploadId] : []),
  ];
  await deleteFilesFromBucket(userId, uploadIds);
  await deleteAudioJob(userId, audioUploadId);
  return c.json({ message: "Job Deleted" }, 200);
}
