import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  AudioTranscriptionJobs,
  db,
  TextSummarizationJobs,
} from "../db";
import type { jobStatusEnum } from "../db";
import type { UploadId } from "../types/mq.types";

/**
 * Both process types read and write these two tables — the API on the request
 * path, the workers as they move a job through its states — so this lives in
 * `shared/` rather than under either service.
 *
 * Types are derived from the schema rather than imported from the API's zod
 * layer: `shared/` must not depend on a service.
 */
type JobStatus = (typeof jobStatusEnum.enumValues)[number];

type AudioRow = typeof AudioTranscriptionJobs.$inferSelect;
type TextRow = typeof TextSummarizationJobs.$inferSelect;

/* ---------------------------------------------------------------- API reads */

/** Ownership scopes every request-path query; the workers deliberately skip it. */
function ownedBy(
  table: typeof AudioTranscriptionJobs | typeof TextSummarizationJobs,
  userId: string,
  uploadId: string,
) {
  return and(eq(table.uploadId, uploadId), eq(table.userId, userId));
}

export async function findTextJob(userId: string, uploadId: string) {
  const [row] = await db
    .select({
      uploadId: TextSummarizationJobs.uploadId,
      fileName: TextSummarizationJobs.fileName,
      status: TextSummarizationJobs.status,
      summary: TextSummarizationJobs.summary,
      error: TextSummarizationJobs.error,
    })
    .from(TextSummarizationJobs)
    .where(ownedBy(TextSummarizationJobs, userId, uploadId))
    .limit(1);

  return row ?? null;
}

export async function findAudioJob(userId: string, uploadId: string) {
  const [row] = await db
    .select({
      uploadId: AudioTranscriptionJobs.uploadId,
      fileName: AudioTranscriptionJobs.fileName,
      status: AudioTranscriptionJobs.status,
      error: AudioTranscriptionJobs.error,
    })
    .from(AudioTranscriptionJobs)
    .where(ownedBy(AudioTranscriptionJobs, userId, uploadId))
    .limit(1);

  return row ?? null;
}

/** The child summary row of an audio job; `uploadId` is its bucket key. */
export async function findAudioChildTextJob(
  userId: string,
  audioUploadId: string,
) {
  const [row] = await db
    .select({
      uploadId: TextSummarizationJobs.uploadId,
      status: TextSummarizationJobs.status,
      summary: TextSummarizationJobs.summary,
    })
    .from(TextSummarizationJobs)
    .where(
      and(
        eq(TextSummarizationJobs.userId, userId),
        eq(TextSummarizationJobs.audioUploadId, audioUploadId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Key only — the delete path needs the bucket key, not the summary text. */
export async function findAudioChildTextUploadId(
  userId: string,
  audioUploadId: string,
) {
  const [row] = await db
    .select({ uploadId: TextSummarizationJobs.uploadId })
    .from(TextSummarizationJobs)
    .where(
      and(
        eq(TextSummarizationJobs.userId, userId),
        eq(TextSummarizationJobs.audioUploadId, audioUploadId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/* --------------------------------------------------------- API job listing */

export type JobCursor = { createdAt: string; uploadId: string };

type SharedCols = Extract<
  keyof AudioRow & keyof TextRow,
  | "uploadId"
  | "fileName"
  | "status"
  | "chosenModelId"
  | "error"
  | "kind"
  | "createdAt"
>;

export type JobSummary = Pick<AudioRow, SharedCols> & {
  kind: "text" | "audio";
};

/** The per-table projections behind JobSummary — the list page needs no more. */
const audioJobColumns = {
  uploadId: AudioTranscriptionJobs.uploadId,
  fileName: AudioTranscriptionJobs.fileName,
  status: AudioTranscriptionJobs.status,
  createdAt: AudioTranscriptionJobs.createdAt,
  chosenModelId: AudioTranscriptionJobs.chosenModelId,
  error: AudioTranscriptionJobs.error,
};

const textJobColumns = {
  uploadId: TextSummarizationJobs.uploadId,
  fileName: TextSummarizationJobs.fileName,
  status: TextSummarizationJobs.status,
  createdAt: TextSummarizationJobs.createdAt,
  chosenModelId: TextSummarizationJobs.chosenModelId,
  error: TextSummarizationJobs.error,
};

/**
 * Newest-first ordering shared by the SQL `ORDER BY` and the in-memory merge:
 * createdAt DESC, then uploadId DESC as a stable tiebreak so the keyset cursor
 * is deterministic across the two tables.
 */
function compareDesc(a: JobSummary, b: JobSummary): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.uploadId !== b.uploadId) return a.uploadId < b.uploadId ? 1 : -1;
  return 0;
}

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

/**
 * One page of the user's history, merged across both job tables and ordered
 * newest-first. Returns whatever `fetchCount` yields — the caller over-fetches
 * to detect a next page, and owns the cursor encoding.
 */
export async function findUserJobsPage(params: {
  userId: string;
  status?: JobStatus;
  searchQuery?: string;
  cursor: JobCursor | null;
  fetchCount: number;
}): Promise<JobSummary[]> {
  const { userId, status, searchQuery, cursor, fetchCount } = params;

  // The two per-table pages are independent reads.
  const [audioJobs, textJobs] = await Promise.all([
    db
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
      .limit(fetchCount),
    db
      .select(textJobColumns)
      .from(TextSummarizationJobs)
      .where(
        and(
          eq(TextSummarizationJobs.userId, userId),
          // Hide audio-derived summaries; they surface via their parent audio job.
          isNull(TextSummarizationJobs.audioUploadId),
          status ? eq(TextSummarizationJobs.status, status) : undefined,
          searchQuery
            ? ilike(TextSummarizationJobs.fileName, `%${searchQuery}%`)
            : undefined,
          afterCursor(
            TextSummarizationJobs.createdAt,
            TextSummarizationJobs.uploadId,
            cursor,
          ),
        ),
      )
      .orderBy(
        desc(TextSummarizationJobs.createdAt),
        desc(TextSummarizationJobs.uploadId),
      )
      .limit(fetchCount),
  ]);

  const merged: JobSummary[] = [];

  for (const row of audioJobs) {
    merged.push({
      kind: "audio",
      uploadId: row.uploadId,
      fileName: row.fileName,
      status: row.status,
      createdAt: row.createdAt,
      chosenModelId: row.chosenModelId,
      error: row.error,
    });
  }

  for (const row of textJobs) {
    merged.push({
      kind: "text",
      uploadId: row.uploadId,
      fileName: row.fileName,
      status: row.status,
      createdAt: row.createdAt,
      chosenModelId: row.chosenModelId,
      error: row.error,
    });
  }

  return merged.sort(compareDesc);
}

/* --------------------------------------------------------------- API writes */

export async function createAudioJob(job: {
  uploadId: UploadId;
  userId: string;
  source: AudioRow["source"];
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  chosenModelId: string;
  transcriptionModelId: string;
  youtubeSourceUrl?: string;
}) {
  const { youtubeSourceUrl, ...columns } = job;

  await db.insert(AudioTranscriptionJobs).values({
    ...columns,
    ...(youtubeSourceUrl !== undefined ? { YT_sourceUrl: youtubeSourceUrl } : {}),
  });
}

/** `audioUploadId` set means this is an audio job's child summary row. */
export async function createTextJob(job: {
  uploadId: UploadId;
  userId: string;
  fileName: string;
  sizeBytes: number;
  chosenModelId: string;
  audioUploadId?: string;
}) {
  await db.insert(TextSummarizationJobs).values(job);
}

export async function deleteAudioJob(userId: string, uploadId: string) {
  await db
    .delete(AudioTranscriptionJobs)
    .where(ownedBy(AudioTranscriptionJobs, userId, uploadId));
}

export async function deleteTextJob(userId: string, uploadId: string) {
  await db
    .delete(TextSummarizationJobs)
    .where(ownedBy(TextSummarizationJobs, userId, uploadId));
}

/**
 * Reset to `queued` for a re-run, clearing the previous result. Null when the
 * user doesn't own it, which the caller reports as a 404.
 */
export async function requeueTextJob(
  userId: string,
  uploadId: string,
  chosenModelId: string,
) {
  const [row] = await db
    .update(TextSummarizationJobs)
    .set({ status: "queued", summary: null, error: null, chosenModelId })
    .where(ownedBy(TextSummarizationJobs, userId, uploadId))
    // Only whether a row matched; the response echoes the request's uploadId.
    .returning({ uploadId: TextSummarizationJobs.uploadId });

  return row ?? null;
}

export async function requeueAudioJob(
  userId: string,
  uploadId: string,
  models: { transcriptionModelId: string; chosenModelId: string },
) {
  const [row] = await db
    .update(AudioTranscriptionJobs)
    .set({ status: "queued", error: null, ...models })
    .where(ownedBy(AudioTranscriptionJobs, userId, uploadId))
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

export async function claimTextJob(uploadId: UploadId) {
  const [row] = await db
    .update(TextSummarizationJobs)
    .set({ status: "processing" })
    .where(
      and(
        eq(TextSummarizationJobs.uploadId, uploadId),
        eq(TextSummarizationJobs.status, "queued"),
      ),
    )
    .returning();

  return row ?? null;
}

/**
 * Terminal transitions are gated on `processing` for the same reason the claim
 * is gated on `queued`: a job re-queued mid-run must not be overwritten by the
 * previous run finishing late.
 */
export async function completeAudioJob(uploadId: UploadId) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "completed" })
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

export async function completeTextJob(uploadId: UploadId, summary: string) {
  await db
    .update(TextSummarizationJobs)
    .set({ status: "completed", summary })
    .where(
      and(
        eq(TextSummarizationJobs.uploadId, uploadId),
        eq(TextSummarizationJobs.status, "processing"),
      ),
    );
}

export async function failTextJob(uploadId: UploadId) {
  await db
    .update(TextSummarizationJobs)
    .set({ status: "failed" })
    .where(
      and(
        eq(TextSummarizationJobs.uploadId, uploadId),
        eq(TextSummarizationJobs.status, "processing"),
      ),
    );
}

/** Unscoped by user: the worker acts on a job it has already claimed. */
export async function findTextJobByAudioUploadId(audioUploadId: UploadId) {
  const [row] = await db
    .select({ uploadId: TextSummarizationJobs.uploadId })
    .from(TextSummarizationJobs)
    .where(eq(TextSummarizationJobs.audioUploadId, audioUploadId))
    .limit(1);

  return row ?? null;
}

/**
 * Re-run of an audio job: the child summary row is reused rather than
 * duplicated, so its previous result is cleared and it goes back to `queued`.
 */
export async function requeueChildTextJob(
  uploadId: UploadId,
  job: { sizeBytes: number; chosenModelId: string },
) {
  await db
    .update(TextSummarizationJobs)
    .set({ status: "queued", summary: null, error: null, ...job })
    .where(eq(TextSummarizationJobs.uploadId, uploadId));
}
