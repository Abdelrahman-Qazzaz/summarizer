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
import {
  AttachmentUploads,
  AudioTranscriptionJobs,
  db,
  type Executor,
} from "../db";
import type { jobStatusEnum } from "../db";
import type { UploadId } from "../types";

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

/** Ownership scopes every request-path query; the worker deliberately skips it. */
function ownedBy(userId: string, audioUploadId: string) {
  return and(
    eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
    inArray(
      AudioTranscriptionJobs.audioUploadId,
      db
        .select({ attachmentUploadId: AttachmentUploads.attachmentUploadId })
        .from(AttachmentUploads)
        .where(
          and(
            eq(AttachmentUploads.attachmentUploadId, audioUploadId),
            eq(AttachmentUploads.userId, userId),
            eq(AttachmentUploads.kind, "audio"),
          ),
        ),
    ),
  );
}

export async function findAudioJob(userId: string, audioUploadId: string) {
  const [row] = await db
    .select({
      audioUploadId: AudioTranscriptionJobs.audioUploadId,
      captionUploadId: AudioTranscriptionJobs.captionUploadId,
      fileName: AttachmentUploads.fileName,
      status: AudioTranscriptionJobs.status,
      error: AudioTranscriptionJobs.error,
    })
    .from(AudioTranscriptionJobs)
    .innerJoin(
      AttachmentUploads,
      eq(
        AttachmentUploads.attachmentUploadId,
        AudioTranscriptionJobs.audioUploadId,
      ),
    )
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        eq(AttachmentUploads.userId, userId),
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
  status: JobStatus;
  error: string | null;
  createdAt: Date;
};

/** The projection behind JobSummary — the list page needs no more. */
const audioJobColumns = {
  audioUploadId: AudioTranscriptionJobs.audioUploadId,
  fileName: AttachmentUploads.fileName,
  status: AudioTranscriptionJobs.status,
  createdAt: AttachmentUploads.createdAt,
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
export async function findUserJobsPage(
  filters: JobsPageFilters,
): Promise<JobSummary[]> {
  const { userId, status, searchQuery, cursor, fetchCount } = filters;

  return db
    .select(audioJobColumns)
    .from(AudioTranscriptionJobs)
    .innerJoin(
      AttachmentUploads,
      eq(
        AttachmentUploads.attachmentUploadId,
        AudioTranscriptionJobs.audioUploadId,
      ),
    )
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "audio"),
        status ? eq(AudioTranscriptionJobs.status, status) : undefined,
        searchQuery
          ? ilike(AttachmentUploads.fileName, `%${searchQuery}%`)
          : undefined,
        afterCursor(
          AttachmentUploads.createdAt,
          AudioTranscriptionJobs.audioUploadId,
          cursor,
        ),
      ),
    )
    .orderBy(
      desc(AttachmentUploads.createdAt),
      desc(AudioTranscriptionJobs.audioUploadId),
    )
    .limit(fetchCount);
}

/* --------------------------------------------------------------- API writes */

export async function createAudioJob(job: {
  audioUploadId: UploadId;
  captionUploadId: UploadId | null;
  userId: string;
  source: AudioJobRow["source"];
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  transcriptModelId: string;
  youtubeSourceUrl?: string;
}) {
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

  await db.transaction(async (tx) => {
    await tx.insert(AttachmentUploads).values({
      attachmentUploadId: audioUploadId,
      kind: "audio",
      userId,
      fileName,
      mimeType,
      sizeBytes,
    });
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

export async function deleteAudioJob(userId: string, audioUploadId: string) {
  await db
    .delete(AttachmentUploads)
    .where(
      and(
        eq(AttachmentUploads.attachmentUploadId, audioUploadId),
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "audio"),
      ),
    );
}

/**
 * Reset a terminal job to `queued`, clearing the previous claim and error. An
 * active job cannot be rerun underneath its worker; broker redelivery owns the
 * separate `processing` recovery path in claimAudioJob.
 */
export async function requeueAudioJob(
  userId: string,
  audioUploadId: string,
  transcriptModelId: string,
) {
  const [row] = await db
    .update(AudioTranscriptionJobs)
    .set({
      status: "queued",
      error: null,
      claimToken: null,
      transcriptModelId,
    })
    .where(
      and(
        ownedBy(userId, audioUploadId),
        inArray(AudioTranscriptionJobs.status, ["completed", "failed"]),
      ),
    )
    // Only whether a row matched; the response echoes the request's audioUploadId.
    .returning({ audioUploadId: AudioTranscriptionJobs.audioUploadId });

  return row ?? null;
}

/**
 * Out-of-band failure reported by youtube-fetcher over the broker. Not
 * user-scoped: the event carries no session, only the id it was given.
 */
export async function failAudioJobById(audioUploadId: string, error: string) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "failed", error })
    .where(eq(AudioTranscriptionJobs.audioUploadId, audioUploadId));
}

export async function findTerminalCaptionUpload(
  audioUploadId: string,
  userId?: string,
) {
  const [row] = await db
    .select({
      audioUploadId: AudioTranscriptionJobs.audioUploadId,
      captionUploadId: AudioTranscriptionJobs.captionUploadId,
      userId: AttachmentUploads.userId,
    })
    .from(AudioTranscriptionJobs)
    .innerJoin(
      AttachmentUploads,
      eq(
        AttachmentUploads.attachmentUploadId,
        AudioTranscriptionJobs.audioUploadId,
      ),
    )
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        userId ? eq(AttachmentUploads.userId, userId) : undefined,
        isNotNull(AudioTranscriptionJobs.captionUploadId),
        inArray(AudioTranscriptionJobs.status, ["completed", "failed"]),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function clearCaptionUploadId(
  audioUploadId: string,
  captionUploadId: UploadId,
) {
  await db
    .update(AudioTranscriptionJobs)
    .set({ captionUploadId: null })
    .where(
      and(
        eq(AudioTranscriptionJobs.audioUploadId, audioUploadId),
        eq(AudioTranscriptionJobs.captionUploadId, captionUploadId),
      ),
    );
}

/* ------------------------------------------------------------ worker writes */

/**
 * Claim a queued job atomically. A broker-redelivered message may also reclaim
 * `processing`: losing the old consumer connection requeues its unACKed message,
 * but does not prove the old process stopped. Replacing claimToken fences that
 * worker out of every terminal write if it later finishes.
 */
export async function claimAudioJob(
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
      userId: AttachmentUploads.userId,
      fileName: AttachmentUploads.fileName,
    })
    .from(AttachmentUploads)
    .where(eq(AttachmentUploads.attachmentUploadId, audioUploadId))
    .limit(1);

  return upload ? { ...job, ...upload, claimToken } : null;
}

/**
 * A terminal transition belongs only to the latest claimant. Returns false when
 * this worker lost ownership, so its caller can discard the stale result.
 */
export async function completeAudioJob(
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

export async function failAudioJob(
  audioUploadId: UploadId,
  claimToken: string,
) {
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
