import type { Context } from "hono";
import { and, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import {
  AudioTranscriptionJobs,
  db,
  TextSummarizationJobs,
} from "../../../../shared/db";
import { readTextFile } from "../../../../shared/bucket";
import type { UploadId } from "../../../../shared/types/mq.types";
import { CTX_KEYS } from "../../../../shared/keys";
import type { JobSummaries } from "../schema/jobs.schema";

export async function handleGetSummarizeJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  const [textJob] = await db
    .select()
    .from(TextSummarizationJobs)
    .where(
      and(
        eq(TextSummarizationJobs.uploadId, uploadId),
        eq(TextSummarizationJobs.userId, userId),
      ),
    )
    .limit(1);

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

  const [audioJob] = await db
    .select()
    .from(AudioTranscriptionJobs)
    .where(
      and(
        eq(AudioTranscriptionJobs.uploadId, uploadId),
        eq(AudioTranscriptionJobs.userId, userId),
      ),
    )
    .limit(1);

  const [textJob] = await db
    .select()
    .from(TextSummarizationJobs)
    .where(
      and(
        eq(TextSummarizationJobs.userId, userId),
        (TextSummarizationJobs.audioUploadId, uploadId),
      ),
    );
  if (audioJob)
    return c.json({
      kind: "audio" as const,
      uploadId: audioJob.uploadId,
      fileName: audioJob.fileName,
      status: audioJob.status,
      summary: textJob ? textJob.summary : null,
      error: audioJob.error,
    });

  return c.json({ message: "Job not found" }, 404);
}

export async function getUserJobs(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const audio = await db
    .select()
    .from(AudioTranscriptionJobs)
    .where(eq(AudioTranscriptionJobs.userId, userId));

  const text = await db
    .select()
    .from(TextSummarizationJobs)
    .where(eq(TextSummarizationJobs.userId, userId));

  const jobs: JobSummaries = { audio, text };

  return c.json({
    jobs,
    nextCursor,
  });
}
