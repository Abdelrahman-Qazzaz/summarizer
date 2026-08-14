import { and, eq, inArray } from "drizzle-orm";
import { TranscriptContents, db, type Executor } from "../db";
import type { UploadId } from "../message-queue/messageQueue";
import { completeAudioJob } from "./jobs.data";

/**
 * The transcript text a completed job produced. Lives here, not in the job row
 * or the bucket, so it can be joined into a chat's context (for `charCount`) and
 * read only for the turns that make the budget. Read scoped by owner; presence
 * of a row means a valid transcript is ready.
 */

/** Worker write: replace on a re-run (the same uploadId transcribed again). */
export async function upsertTranscript(
  userId: string,
  uploadId: UploadId,
  content: string,
  executor: Executor = db,
) {
  await executor
    .insert(TranscriptContents)
    .values({ uploadId, userId, content, charCount: content.length })
    .onConflictDoUpdate({
      target: TranscriptContents.uploadId,
      set: { content, charCount: content.length },
    });
}

/**
 * Stores the transcript and marks the job completed in one transaction, so a
 * crash can't leave a job stuck `processing` with a transcript already written
 * (or a completed job with none).
 */
export async function saveCompletedTranscript(
  userId: string,
  uploadId: UploadId,
  content: string,
) {
  await db.transaction(async (tx) => {
    await upsertTranscript(userId, uploadId, content, tx);
    await completeAudioJob(uploadId, tx);
  });
}

/** The transcript a chat turn wants to carry, or null when there isn't one yet. */
export async function findTranscript(userId: string, uploadId: string) {
  const [row] = await db
    .select({ content: TranscriptContents.content })
    .from(TranscriptContents)
    .where(
      and(
        eq(TranscriptContents.uploadId, uploadId),
        eq(TranscriptContents.userId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Bodies for a set of turns at once, keyed by uploadId — the batched context read. */
export async function findTranscriptContents(
  userId: string,
  uploadIds: readonly string[],
): Promise<Map<string, string>> {
  if (uploadIds.length === 0) return new Map();

  const rows = await db
    .select({
      uploadId: TranscriptContents.uploadId,
      content: TranscriptContents.content,
    })
    .from(TranscriptContents)
    .where(
      and(
        eq(TranscriptContents.userId, userId),
        inArray(TranscriptContents.uploadId, [...uploadIds]),
      ),
    );

  return new Map(rows.map((row) => [row.uploadId, row.content]));
}

/** A re-run drops the old transcript; the worker upserts the new one on completion. */
export async function deleteTranscript(uploadId: string) {
  await db
    .delete(TranscriptContents)
    .where(eq(TranscriptContents.uploadId, uploadId));
}
