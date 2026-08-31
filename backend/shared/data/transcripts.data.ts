import { and, asc, eq, inArray } from "drizzle-orm";
import {
  AttachmentUploads,
  AudioTranscriptionJobs,
  ChatMessageAttachments,
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

/** Worker write: replace on a re-run (the same audioUploadId transcribed again). */
export async function upsertTranscript(
  audioUploadId: UploadId,
  content: string,
  executor: Executor = db,
) {
  await executor
    .insert(TranscriptContents)
    .values({
      audioUploadId,
      content,
      charCount: content.length,
    })
    .onConflictDoUpdate({
      target: TranscriptContents.audioUploadId,
      set: { content, charCount: content.length },
    });
}

/**
 * Stores the transcript and marks the job completed in one transaction, so a
 * crash can't leave a job stuck `processing` with a transcript already written
 * (or a completed job with none).
 */
export async function saveCompletedTranscript(
  audioUploadId: UploadId,
  content: string,
  claimToken: string,
) {
  return db.transaction(async (tx) => {
    const ownsJob = await completeAudioJob(audioUploadId, claimToken, tx);
    if (!ownsJob) return false;

    await upsertTranscript(audioUploadId, content, tx);
    return true;
  });
}

/** Bodies for a set of turns at once, keyed by audioUploadId — the batched context read. */
export async function findTranscripts(
  userId: string,
  audioUploadIds: readonly string[],
): Promise<Map<string, string>> {
  if (audioUploadIds.length === 0) return new Map<string, string>();

  const rows = await db
    .select({
      audioUploadId: TranscriptContents.audioUploadId,
      content: TranscriptContents.content,
    })
    .from(TranscriptContents)
    .innerJoin(
      AttachmentUploads,
      eq(
        AttachmentUploads.attachmentUploadId,
        TranscriptContents.audioUploadId,
      ),
    )
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "audio"),
        inArray(TranscriptContents.audioUploadId, [...audioUploadIds]),
      ),
    );

  return new Map(rows.map((row) => [row.audioUploadId, row.content]));
}

export type StoredTranscriptAttachment = {
  audioUploadId: string;
  fileName: string;
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
      messageId: ChatMessageAttachments.messageId,
      audioUploadId: AudioTranscriptionJobs.audioUploadId,
      fileName: AttachmentUploads.fileName,
      source: AudioTranscriptionJobs.source,
      charCount: TranscriptContents.charCount,
    })
    .from(ChatMessageAttachments)
    .innerJoin(
      AttachmentUploads,
      and(
        eq(
          AttachmentUploads.attachmentUploadId,
          ChatMessageAttachments.attachmentUploadId,
        ),
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "audio"),
      ),
    )
    .innerJoin(
      AudioTranscriptionJobs,
      eq(
        AudioTranscriptionJobs.audioUploadId,
        ChatMessageAttachments.attachmentUploadId,
      ),
    )
    .leftJoin(
      TranscriptContents,
      and(
        eq(
          TranscriptContents.audioUploadId,
          AudioTranscriptionJobs.audioUploadId,
        ),
      ),
    )
    .where(inArray(ChatMessageAttachments.messageId, [...messageIds]))
    .orderBy(
      asc(ChatMessageAttachments.messageId),
      asc(ChatMessageAttachments.position),
    );

  for (const { messageId, ...transcription } of rows) {
    const transcripts = transcriptionsByMessageId.get(messageId) ?? [];
    transcripts.push(transcription);
    transcriptionsByMessageId.set(messageId, transcripts);
  }

  return transcriptionsByMessageId;
}

/** A re-run drops the old transcript; the worker upserts the new one on completion. */
export async function deleteTranscript(audioUploadId: string) {
  await db
    .delete(TranscriptContents)
    .where(eq(TranscriptContents.audioUploadId, audioUploadId));
}
