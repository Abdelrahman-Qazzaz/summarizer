import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Attachments, AudioTranscriptionJobs, db, type Executor } from "../db";
import type { jobStatusEnum } from "../db";
import type { UploadId } from "../types";
import { attachments } from "./attachments.data";
import { storageLedger } from "./storageLedger.data";

/**
 * Both process types read and write this table — the API on the request path,
 * the worker as it moves a job through its states — so this lives in `shared/`
 * rather than under either service.
 *
 * Types are derived from the schema rather than imported from the API's zod
 * layer: `shared/` must not depend on a service.
 */
type JobStatus = (typeof jobStatusEnum.enumValues)[number];

type AudioJobRow = typeof AudioTranscriptionJobs.$inferSelect;

/* ---------------------------------------------------------------- API reads */

async function findAudioJob(userId: string, audioUploadId: string) {
  const [row] = await db
    .select({
      audioUploadId: AudioTranscriptionJobs.audioUploadId,
      captionUploadId: AudioTranscriptionJobs.captionUploadId,
      fileName: Attachments.fileName,
      source: AudioTranscriptionJobs.source,
      youtubeSourceUrl: AudioTranscriptionJobs.YT_sourceUrl,
      status: AudioTranscriptionJobs.status,
      error: AudioTranscriptionJobs.error,
    })
    .from(AudioTranscriptionJobs)
    .innerJoin(
      Attachments,
      eq(Attachments.attachmentId, AudioTranscriptionJobs.audioUploadId),
    )
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        eq(Attachments.userId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/* --------------------------------------------------------- API job listing */

export type JobCursor = { createdAt: string; audioUploadId: string };

export type JobSummary = {
  audioUploadId: string;
  fileName: string;
  source: string;
  status: JobStatus;
  error: string | null;
  createdAt: Date;
};

/** The projection behind JobSummary — the list page needs no more. */
const audioJobColumns = {
  audioUploadId: AudioTranscriptionJobs.audioUploadId,
  fileName: Attachments.fileName,
  source: AudioTranscriptionJobs.source,
  status: AudioTranscriptionJobs.status,
  createdAt: Attachments.createdAt,
  error: AudioTranscriptionJobs.error,
};

/**
 * Keyset predicate: rows strictly "after" the cursor in (createdAt, audioUploadId)
 * DESC order. Casts the cursor timestamp in SQL so it works regardless of the
 * column's driver read mode.
 */
function afterCursor(
  createdAtCol: AnyPgColumn,
  audioUploadIdCol: AnyPgColumn,
  cursor: JobCursor | null,
) {
  if (!cursor) return undefined;
  const cursorCreatedAt = sql`${cursor.createdAt}::timestamptz`;
  return or(
    lt(createdAtCol, cursorCreatedAt),
    and(
      eq(createdAtCol, cursorCreatedAt),
      lt(audioUploadIdCol, cursor.audioUploadId),
    ),
  );
}

type JobsPageFilters = {
  userId: string;
  status?: JobStatus;
  searchQuery?: string;
  cursor: JobCursor | null;
  fetchCount: number;
};

/**
 * One page of the user's history, newest first. Returns whatever `fetchCount`
 * yields — the caller over-fetches to detect a next page, and owns the cursor
 * encoding. The audioUploadId tiebreak in the ordering is what makes the keyset
 * cursor deterministic.
 */
async function findUserJobsPage(
  filters: JobsPageFilters,
): Promise<JobSummary[]> {
  const { userId, status, searchQuery, cursor, fetchCount } = filters;

  return db
    .select(audioJobColumns)
    .from(AudioTranscriptionJobs)
    .innerJoin(
      Attachments,
      eq(Attachments.attachmentId, AudioTranscriptionJobs.audioUploadId),
    )
    .where(
      and(
        eq(Attachments.userId, userId),
        eq(Attachments.kind, "audio"),
        status ? eq(AudioTranscriptionJobs.status, status) : undefined,
        searchQuery
          ? ilike(Attachments.fileName, `%${searchQuery}%`)
          : undefined,
        afterCursor(
          Attachments.createdAt,
          AudioTranscriptionJobs.audioUploadId,
          cursor,
        ),
      ),
    )
    .orderBy(
      desc(Attachments.createdAt),
      desc(AudioTranscriptionJobs.audioUploadId),
    )
    .limit(fetchCount);
}

/* --------------------------------------------------------------- API writes */

/**
 * The attachment row and the job row, together. `executor` lets a direct
 * upload's confirm write them in the transaction that confirms the upload.
 */
async function createAudioJob(
  job: {
    audioUploadId: UploadId;
    captionUploadId: UploadId | null;
    userId: string;
    source: AudioJobRow["source"];
    fileName: string;
    mimeType: string | null;
    sizeBytes: number;
    transcriptModelId: string;
    youtubeSourceUrl?: string;
  },
  executor: Executor = db,
) {
  const {
    audioUploadId,
    captionUploadId,
    userId,
    source,
    fileName,
    mimeType,
    sizeBytes,
    transcriptModelId,
    youtubeSourceUrl,
  } = job;

  await executor.transaction(async (tx) => {
    await attachments.createAttachment(
      {
        attachmentId: audioUploadId,
        kind: "audio",
        userId,
        fileName,
        mimeType,
        sizeBytes,
      },
      tx,
    );
    await tx.insert(AudioTranscriptionJobs).values({
      audioUploadId,
      captionUploadId,
      source,
      transcriptModelId,
      ...(youtubeSourceUrl !== undefined
        ? { YT_sourceUrl: youtubeSourceUrl }
        : {}),
    });
  });
}

/**
 * A YouTube job, and the objects the fetcher will write for it recorded as
 * referenced — audio, and the caption text when one is reserved — in the
 * same transaction. They're recorded now rather than when they land, so an
 * object the fetcher writes is never unrecorded; recording one that never
 * arrives costs nothing, since deleting a missing object is a no-op.
 */
async function createYoutubeAudioJob(
  job: Parameters<typeof createAudioJob>[0],
) {
  await db.transaction(async (tx) => {
    await createAudioJob(job, tx);
    await storageLedger.recordConfirmedObjects(
      job.userId,
      [
        { kind: "audio", uploadId: job.audioUploadId },
        ...(job.captionUploadId
          ? [{ kind: "text" as const, uploadId: job.captionUploadId }]
          : []),
      ],
      tx,
    );
  });
}

/**
 * Deletes a job's audio attachment, and with it the job, unless it's linked to
 * a message or reserved for a response. Marks the audio, and the job's
 * caption text if it still has one, as deleted in the same transaction.
 * Returns null when nothing was deleted, and otherwise says whether its fetch
 * could still write the objects the caller is about to remove.
 */
async function deleteAudioJob(userId: string, audioUploadId: string) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({
        captionUploadId: AudioTranscriptionJobs.captionUploadId,
        source: AudioTranscriptionJobs.source,
        status: AudioTranscriptionJobs.status,
      })
      .from(AudioTranscriptionJobs)
      .where(eq(AudioTranscriptionJobs.audioUploadId, audioUploadId));

    const deletedAudioUploadId =
      await attachments.deleteOwnedUnlinkedUnreservedAttachment(
        { userId, attachmentId: audioUploadId, kind: "audio" },
        tx,
      );
    if (!deletedAudioUploadId) return null;

    const captionUploadId = job?.captionUploadId ?? null;
    if (captionUploadId) {
      await storageLedger.markDeleted(
        userId,
        [{ kind: "text", uploadId: captionUploadId }],
        tx,
      );
    }
    // A youtube fetch runs in another process that nothing here can stop, so
    // until the job reaches a terminal status its objects may still land.
    const fetchMayStillWrite =
      job?.source === "youtube" &&
      job.status !== "completed" &&
      job.status !== "failed";

    return { captionUploadId, fetchMayStillWrite };
  });
}

/**
 * Out-of-band failure reported by youtube-fetcher over the broker. Not
 * user-scoped: the event carries no session, only the id it was given.
 */
async function failAudioJobById(audioUploadId: string, error: string) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "failed", error })
    .where(eq(AudioTranscriptionJobs.audioUploadId, audioUploadId));
}

async function findTerminalCaptionUpload(
  audioUploadId: string,
  userId?: string,
) {
  const [row] = await db
    .select({
      audioUploadId: AudioTranscriptionJobs.audioUploadId,
      captionUploadId: AudioTranscriptionJobs.captionUploadId,
      userId: Attachments.userId,
    })
    .from(AudioTranscriptionJobs)
    .innerJoin(
      Attachments,
      eq(Attachments.attachmentId, AudioTranscriptionJobs.audioUploadId),
    )
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        userId ? eq(Attachments.userId, userId) : undefined,
        isNotNull(AudioTranscriptionJobs.captionUploadId),
        inArray(AudioTranscriptionJobs.status, ["completed", "failed"]),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Clears a job's caption id and marks its text deleted, in one transaction.
 * False when the job no longer points at that caption.
 */
async function clearCaptionUploadId(
  audioUploadId: string,
  captionUploadId: UploadId,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const [cleared] = await tx
      .update(AudioTranscriptionJobs)
      .set({ captionUploadId: null })
      .where(
        and(
          eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
          eq(AudioTranscriptionJobs.captionUploadId, captionUploadId),
        ),
      )
      .returning({ audioUploadId: AudioTranscriptionJobs.audioUploadId });
    if (!cleared) return false;

    await storageLedger.markDeleted(
      userId,
      [{ kind: "text", uploadId: captionUploadId }],
      tx,
    );
    return true;
  });
}

/* ------------------------------------------------------------ worker writes */

/**
 * Claim a queued job atomically. A broker-redelivered message may also reclaim
 * `processing`: losing the old consumer connection requeues its unACKed message,
 * but does not prove the old process stopped. Replacing claimToken fences that
 * worker out of every terminal write if it later finishes.
 */
async function claimAudioJob(
  audioUploadId: UploadId,
  allowProcessingRecovery = false,
) {
  const claimToken = randomUUID();
  const [job] = await db
    .update(AudioTranscriptionJobs)
    .set({ status: "processing", claimToken })
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        allowProcessingRecovery
          ? inArray(AudioTranscriptionJobs.status, ["queued", "processing"])
          : eq(AudioTranscriptionJobs.status, "queued"),
      ),
    )
    .returning();

  if (!job) return null;

  const [upload] = await db
    .select({
      userId: Attachments.userId,
      fileName: Attachments.fileName,
    })
    .from(Attachments)
    .where(eq(Attachments.attachmentId, audioUploadId))
    .limit(1);

  return upload ? { ...job, ...upload, claimToken } : null;
}

/**
 * A terminal transition belongs only to the latest claimant. Returns false when
 * this worker lost ownership, so its caller can discard the stale result.
 */
async function completeAudioJob(
  audioUploadId: UploadId,
  claimToken: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .update(AudioTranscriptionJobs)
    .set({ status: "completed" })
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        eq(AudioTranscriptionJobs.status, "processing"),
        eq(AudioTranscriptionJobs.claimToken, claimToken),
      ),
    )
    .returning({ audioUploadId: AudioTranscriptionJobs.audioUploadId });

  return Boolean(row);
}

async function failAudioJob(audioUploadId: UploadId, claimToken: string) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "failed" })
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        eq(AudioTranscriptionJobs.status, "processing"),
        eq(AudioTranscriptionJobs.claimToken, claimToken),
      ),
    );
}

export const jobs = {
  findAudioJob,
  findUserJobsPage,
  createAudioJob,
  createYoutubeAudioJob,
  deleteAudioJob,
  failAudioJobById,
  findTerminalCaptionUpload,
  clearCaptionUploadId,
  claimAudioJob,
  completeAudioJob,
  failAudioJob,
};
