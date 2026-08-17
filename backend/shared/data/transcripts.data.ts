import { and, asc, eq, inArray } from "drizzle-orm";
import {
  AudioTranscriptionJobs,
  ChatMessageTranscriptions,
  TranscriptContents,
  db,
  type Executor,
} from "../db";

import { completeAudioJob } from "./jobs.data";
import type { UploadId } from "../types";

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
  title: string,
  executor: Executor = db,
) {
  await executor
    .insert(TranscriptContents)
    .values({ uploadId, userId, content, charCount: content.length, title })
    .onConflictDoUpdate({
      target: TranscriptContents.uploadId,
      set: { content, charCount: content.length, title },
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
  title: string,
  claimToken: string,
) {
  return db.transaction(async (tx) => {
    const ownsJob = await completeAudioJob(uploadId, claimToken, tx);
    if (!ownsJob) return false;

    await upsertTranscript(userId, uploadId, content, title, tx);
    return true;
  });
}

/** Bodies for a set of turns at once, keyed by uploadId — the batched context read. */
export async function findTranscripts(
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

export type StoredTranscriptAttachment = {
  uploadId: string;
  fileName: string;
  title: string | null;
  source: string;
  charCount: number | null;
};

/** Ordered transcription attachments grouped by chat message. */
export async function findMessageTranscriptAttachments(
  userId: string,
  messageIds: readonly string[],
): Promise<Map<string, StoredTranscriptAttachment[]>> {
  const transcriptionsByMessageId = new Map<
    string,
    StoredTranscriptAttachment[]
  >();
  if (messageIds.length === 0) return transcriptionsByMessageId;

  const rows = await db
    .select({
      messageId: ChatMessageTranscriptions.messageId,
      uploadId: AudioTranscriptionJobs.uploadId,
      fileName: AudioTranscriptionJobs.fileName,
      title: TranscriptContents.title,
      source: AudioTranscriptionJobs.source,
      charCount: TranscriptContents.charCount,
    })
    .from(ChatMessageTranscriptions)
    .innerJoin(
      AudioTranscriptionJobs,
      and(
        eq(
          AudioTranscriptionJobs.uploadId,
          ChatMessageTranscriptions.audioUploadId,
        ),
        eq(AudioTranscriptionJobs.userId, userId),
      ),
    )
    .leftJoin(
      TranscriptContents,
      and(
        eq(TranscriptContents.uploadId, AudioTranscriptionJobs.uploadId),
        eq(TranscriptContents.userId, userId),
      ),
    )
    .where(inArray(ChatMessageTranscriptions.messageId, [...messageIds]))
    .orderBy(
      asc(ChatMessageTranscriptions.messageId),
      asc(ChatMessageTranscriptions.position),
    );

  for (const { messageId, ...transcription } of rows) {
    const transcripts = transcriptionsByMessageId.get(messageId) ?? [];
    transcripts.push(transcription);
    transcriptionsByMessageId.set(messageId, transcripts);
  }

  return transcriptionsByMessageId;
}

export async function attachTranscriptionsToMessage(
  messageId: string,
  audioUploadIds: readonly string[],
  executor: Executor = db,
) {
  if (audioUploadIds.length === 0) return;

  await executor.insert(ChatMessageTranscriptions).values(
    audioUploadIds.map((audioUploadId, position) => ({
      messageId,
      audioUploadId,
      position,
    })),
  );
}

/** A re-run drops the old transcript; the worker upserts the new one on completion. */
export async function deleteTranscript(uploadId: string) {
  await db
    .delete(TranscriptContents)
    .where(eq(TranscriptContents.uploadId, uploadId));
}
