import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import {
  AudioTranscriptionJobs,
  db,
  TextSummarizationJobs,
} from "../../../../shared/db";
import { CTX_KEYS } from "../auth/contextKeys";

export async function handleGetJob(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.req.param("uploadId");
  if (!uploadId) return c.json({ message: "uploadId required" }, 400);

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

  if (audioJob)
    return c.json({
      kind: "audio" as const,
      uploadId: audioJob.uploadId,
      fileName: audioJob.fileName,
      status: audioJob.status,
      transcript: audioJob.transcript,
      error: audioJob.error,
    });

  return c.json({ message: "Job not found" }, 404);
}
