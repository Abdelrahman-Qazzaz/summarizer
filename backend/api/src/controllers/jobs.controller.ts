import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { CTX_KEYS } from "../../../shared/keys";
import { jobCursorSchema, type JobStatus } from "../schema/jobs.schema";
import { encodeCursor, decodeCursor } from "../utils/cursor";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import { cleanupTerminalCaptionUpload } from "../../../shared/captionUploads";
import { mq } from "../../../shared/message-queue/messageQueue";
import {
  deleteAudioJob,
  findAudioJob,
  findUserJobsPage,
  requeueAudioJob,
} from "../../../shared/data/jobs.data";
import {
  deleteTranscript,
  findTranscripts,
} from "../../../shared/data/transcripts.data";
import { tryCatch } from "../../../shared/try-catch";
import { logger } from "../../../shared/logger";
import type { UploadId } from "../../../shared/types";

const log = logger.child({ controller: "jobs" });

export async function handleGetTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId = c.get(CTX_KEYS.audioUploadId);

  // A transcript row exists only for a completed job (a re-run drops it), so its
  // presence is enough — no status gate, and it's the user's own by the scope.
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

/**
 * Re-transcribe an audio object already stored for this job.
 */
export async function handleRerunTranscribeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId = c.get(CTX_KEYS.audioUploadId);
  const transcriptModelId = c.get(CTX_KEYS.transcriptModelId);

  const existingJob = await findAudioJob(userId, audioUploadId);
  if (!existingJob) return c.json({ message: "Job not found" }, 404);
  if (existingJob.source === "youtube") {
    return c.json(
      { message: "YouTube jobs must use the YouTube rerun route" },
      400,
    );
  }

  const job = await requeueAudioJob(userId, audioUploadId, transcriptModelId);

  if (!job) {
    return c.json({ message: "Job is already queued or processing" }, 409);
  }

  await deleteTranscript(audioUploadId);
  await mq.publish(mq.queues.TRANSCRIBE, { audioUploadId });
  return c.json({ audioUploadId });
}

/** Re-fetch a YouTube job and replace its stored transcript. */
export async function handleRerunYoutubeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId = c.get(CTX_KEYS.audioUploadId);
  const transcriptModelId = c.get(CTX_KEYS.transcriptModelId);
  const useCaptionsIfAvailable = c.get(CTX_KEYS.useCaptionsIfAvailable);

  const existingJob = await findAudioJob(userId, audioUploadId);
  if (!existingJob) return c.json({ message: "Job not found" }, 404);
  if (existingJob.source !== "youtube") {
    return c.json(
      { message: "Only YouTube jobs can use the YouTube rerun route" },
      400,
    );
  }
  if (!existingJob.youtubeSourceUrl) {
    return c.json({ message: "YouTube source URL is unavailable" }, 409);
  }

  await cleanupTerminalCaptionUpload(audioUploadId, userId);
  const captionUploadId: UploadId | null = useCaptionsIfAvailable
    ? randomUUID()
    : null;
  const job = await requeueAudioJob(
    userId,
    audioUploadId,
    transcriptModelId,
    captionUploadId,
  );
  if (!job) {
    return c.json({ message: "Job is already queued or processing" }, 409);
  }

  await deleteTranscript(audioUploadId);
  await mq.publish(mq.queues.YT_FETCH, {
    audioUploadId,
    captionUploadId,
    userId,
    url: existingJob.youtubeSourceUrl,
    useCaptionsIfAvailable,
  });
  return c.json({ audioUploadId });
}
