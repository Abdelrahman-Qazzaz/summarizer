import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { AudioTranscriptionJobs, db } from "../db";
import type { jobStatusEnum } from "../db";
import type { UploadId } from "../types/mq.types";

/**
 * Both process types read and write this table — the API on the request path,
 * the worker as it moves a job through its states — so this lives in `shared/`
 * rather than under either service.
 *
 * Types are derived from the schema rather than imported from the API's zod
 * layer: `shared/` must not depend on a service.
 */
type JobStatus = (typeof jobStatusEnum.enumValues)[number];

type AudioRow = typeof AudioTranscriptionJobs.$inferSelect;

/* ---------------------------------------------------------------- API reads */

/** Ownership scopes every request-path query; the worker deliberately skips it. */
function ownedBy(userId: string, uploadId: string) {
  return and(
    eq(AudioTranscriptionJobs.uploadId, uploadId),
    eq(AudioTranscriptionJobs.userId, userId),
  );
}

export async function findAudioJob(userId: string, uploadId: string) {
  const [row] = await db
    .select({
      uploadId: AudioTranscriptionJobs.uploadId,
      fileName: AudioTranscriptionJobs.fileName,
      status: AudioTranscriptionJobs.status,
      transcriptUploadId: AudioTranscriptionJobs.transcriptUploadId,
      error: AudioTranscriptionJobs.error,
    })
    .from(AudioTranscriptionJobs)
    .where(ownedBy(userId, uploadId))
    .limit(1);

  return row ?? null;
}

/**
 * The transcript a chat turn wants to carry. Returns the bucket key and the
 * job's status so the caller can refuse a job that has no transcript yet —
 * `transcriptUploadId` is only written once transcription completes.
 */
export async function findOwnedTranscript(userId: string, uploadId: string) {
  const [row] = await db
    .select({
      transcriptUploadId: AudioTranscriptionJobs.transcriptUploadId,
      status: AudioTranscriptionJobs.status,
    })
    .from(AudioTranscriptionJobs)
    .where(ownedBy(userId, uploadId))
    .limit(1);

  return row ?? null;
}

/**
 * The batch form of findOwnedTranscript: every named job the user owns, in one
 * query, so replaying a history of audio turns costs a single round-trip rather
 * than one per turn. Same projection; the uploadId rides along so a caller can
 * key the results back to the message that named it.
 */
export async function findOwnedTranscripts(
  userId: string,
  uploadIds: readonly string[],
) {
  if (uploadIds.length === 0) return [];

  return db
    .select({
      uploadId: AudioTranscriptionJobs.uploadId,
      transcriptUploadId: AudioTranscriptionJobs.transcriptUploadId,
      status: AudioTranscriptionJobs.status,
    })
    .from(AudioTranscriptionJobs)
    .where(
      and(
        eq(AudioTranscriptionJobs.userId, userId),
        inArray(AudioTranscriptionJobs.uploadId, [...uploadIds]),
      ),
    );
}

/* --------------------------------------------------------- API job listing */

export type JobCursor = { createdAt: string; uploadId: string };

export type JobSummary = Pick<
  AudioRow,
  "uploadId" | "fileName" | "status" | "error" | "createdAt"
>;

/** The projection behind JobSummary — the list page needs no more. */
const audioJobColumns = {
  uploadId: AudioTranscriptionJobs.uploadId,
  fileName: AudioTranscriptionJobs.fileName,
  status: AudioTranscriptionJobs.status,
  createdAt: AudioTranscriptionJobs.createdAt,
  error: AudioTranscriptionJobs.error,
};

/**
 * Keyset predicate: rows strictly "after" the cursor in (createdAt, uploadId)
 * DESC order. Casts the cursor timestamp in SQL so it works regardless of the
 * column's driver read mode.
 */
function afterCursor(
  createdAtCol: AnyPgColumn,
  uploadIdCol: AnyPgColumn,
  cursor: JobCursor | null,
) {
  if (!cursor) return undefined;
  const cursorCreatedAt = sql`${cursor.createdAt}::timestamptz`;
  return or(
    lt(createdAtCol, cursorCreatedAt),
    and(eq(createdAtCol, cursorCreatedAt), lt(uploadIdCol, cursor.uploadId)),
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
 * encoding. The uploadId tiebreak in the ordering is what makes the keyset
 * cursor deterministic.
 */
export async function findUserJobsPage(
  filters: JobsPageFilters,
): Promise<JobSummary[]> {
  const { userId, status, searchQuery, cursor, fetchCount } = filters;

  return db
    .select(audioJobColumns)
    .from(AudioTranscriptionJobs)
    .where(
      and(
        eq(AudioTranscriptionJobs.userId, userId),
        status ? eq(AudioTranscriptionJobs.status, status) : undefined,
        searchQuery
          ? ilike(AudioTranscriptionJobs.fileName, `%${searchQuery}%`)
          : undefined,
        afterCursor(
          AudioTranscriptionJobs.createdAt,
          AudioTranscriptionJobs.uploadId,
          cursor,
        ),
      ),
    )
    .orderBy(
      desc(AudioTranscriptionJobs.createdAt),
      desc(AudioTranscriptionJobs.uploadId),
    )
    .limit(fetchCount);
}

/* --------------------------------------------------------------- API writes */

export async function createAudioJob(job: {
  uploadId: UploadId;
  userId: string;
  source: AudioRow["source"];
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  transcriptionModelId: string;
  youtubeSourceUrl?: string;
}) {
  const { youtubeSourceUrl, ...columns } = job;

  await db.insert(AudioTranscriptionJobs).values({
    ...columns,
    ...(youtubeSourceUrl !== undefined
      ? { YT_sourceUrl: youtubeSourceUrl }
      : {}),
  });
}

export async function deleteAudioJob(userId: string, uploadId: string) {
  await db.delete(AudioTranscriptionJobs).where(ownedBy(userId, uploadId));
}

/**
 * Reset to `queued` for a re-run, clearing the previous error. Null when the
 * user doesn't own it, which the caller reports as a 404.
 *
 * `transcriptUploadId` is deliberately kept rather than cleared: the worker
 * overwrites that same object, so holding the key is what stops a re-run from
 * orphaning the previous transcript in storage.
 */
export async function requeueAudioJob(
  userId: string,
  uploadId: string,
  transcriptionModelId: string,
) {
  const [row] = await db
    .update(AudioTranscriptionJobs)
    .set({ status: "queued", error: null, transcriptionModelId })
    .where(ownedBy(userId, uploadId))
    // Only whether a row matched; the response echoes the request's uploadId.
    .returning({ uploadId: AudioTranscriptionJobs.uploadId });

  return row ?? null;
}

/**
 * Out-of-band failure reported by youtube-fetcher over the broker. Not
 * user-scoped: the event carries no session, only the id it was given.
 */
export async function failAudioJobById(uploadId: string, error: string) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "failed", error })
    .where(eq(AudioTranscriptionJobs.uploadId, uploadId));
}

/* ------------------------------------------------------------ worker writes */

/**
 * Claim a queued job atomically. Combined with RabbitMQ delivering each message
 * to one consumer, this is what makes running many worker replicas safe: the
 * `queued` predicate means a second claimant gets no row back and bails.
 */
export async function claimAudioJob(uploadId: UploadId) {
  const [row] = await db
    .update(AudioTranscriptionJobs)
    .set({ status: "processing" })
    .where(
      and(
        eq(AudioTranscriptionJobs.uploadId, uploadId),
        eq(AudioTranscriptionJobs.status, "queued"),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * Terminal transitions are gated on `processing` for the same reason the claim
 * is gated on `queued`: a job re-queued mid-run must not be overwritten by the
 * previous run finishing late. The transcript key rides along in the same
 * statement rather than a second one — one round-trip, and it falls under the
 * same gate, so a stale run can't stamp its key onto a job someone re-queued.
 */
export async function completeAudioJob(
  uploadId: UploadId,
  transcriptUploadId: UploadId,
) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "completed", transcriptUploadId })
    .where(
      and(
        eq(AudioTranscriptionJobs.uploadId, uploadId),
        eq(AudioTranscriptionJobs.status, "processing"),
      ),
    );
}

export async function failAudioJob(uploadId: UploadId) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "failed" })
    .where(
      and(
        eq(AudioTranscriptionJobs.uploadId, uploadId),
        eq(AudioTranscriptionJobs.status, "processing"),
      ),
    );
}
