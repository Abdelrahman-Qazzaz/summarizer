import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  AttachmentTurnReservations,
  AttachmentUploads,
  Conversations,
  db,
  type Executor,
} from "../db";
import { CLAIM_LEASE_MS } from "./conversations.data";
import { attachmentUploadIsUnattached } from "./messageAttachments.data";

type AttachmentUploadValues = Pick<
  typeof AttachmentUploads.$inferInsert,
  | "attachmentUploadId"
  | "kind"
  | "userId"
  | "fileName"
  | "mimeType"
  | "sizeBytes"
  | "signedUrl"
  | "signedUrlExpiresAt"
>;

type OwnedUnattachedAttachment = {
  userId: string;
  attachmentUploadId: string;
  kind: AttachmentUploadValues["kind"];
};

type OwnedUnattachedAttachments = {
  userId: string;
  attachmentUploadIds: readonly string[];
  kind: AttachmentUploadValues["kind"];
};

type OwnedAttachmentUploads = {
  userId: string;
  attachmentUploadIds?: readonly string[];
  kind: AttachmentUploadValues["kind"];
};

export function userOwnsAttachmentUploads(input: OwnedAttachmentUploads) {
  return and(
    eq(AttachmentUploads.userId, input.userId),
    eq(AttachmentUploads.kind, input.kind),
    input.attachmentUploadIds === undefined
      ? undefined
      : inArray(AttachmentUploads.attachmentUploadId, [
          ...input.attachmentUploadIds,
        ]),
  );
}

function ownedUnattachedAttachments(
  input: OwnedUnattachedAttachments,
  executor: Executor,
) {
  // A slow provider may outlive the lease while its conversation claim still owns the turn.
  return and(
    userOwnsAttachmentUploads(input),
    attachmentUploadIsUnattached(executor),
    sql`not exists (
      select 1 from ${AttachmentTurnReservations}
      where ${AttachmentTurnReservations.attachmentUploadId} = ${AttachmentUploads.attachmentUploadId}
        and (${AttachmentTurnReservations.expiresAt} > now() or exists (
          select 1 from ${Conversations}
          where ${Conversations.activeTurnClaimToken} = ${AttachmentTurnReservations.claimToken}
        ))
    )`,
  );
}

async function lockOwnedAttachmentUploads(
  userId: string,
  attachmentUploadIds: readonly string[],
  executor: Executor,
) {
  return executor
    .select({ attachmentUploadId: AttachmentUploads.attachmentUploadId })
    .from(AttachmentUploads)
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        inArray(AttachmentUploads.attachmentUploadId, [...attachmentUploadIds]),
      ),
    )
    .orderBy(asc(AttachmentUploads.attachmentUploadId))
    .for("update");
}

export async function reserveAttachmentUploads(
  userId: string,
  attachmentUploadIds: readonly string[],
  claimToken: string,
) {
  const uniqueUploadIds = [...new Set(attachmentUploadIds)];
  if (uniqueUploadIds.length === 0) return true;

  return db.transaction(async (transaction) => {
    const uploads = await lockOwnedAttachmentUploads(
      userId,
      uniqueUploadIds,
      transaction,
    );
    if (uploads.length !== uniqueUploadIds.length) return false;

    await transaction.insert(AttachmentTurnReservations).values(
      uniqueUploadIds.map((attachmentUploadId) => ({
        attachmentUploadId,
        claimToken,
        expiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
      })),
    );
    return true;
  });
}

export async function releaseAttachmentReservations(
  claimToken: string,
  executor: Executor = db,
) {
  await executor
    .delete(AttachmentTurnReservations)
    .where(eq(AttachmentTurnReservations.claimToken, claimToken));
}

export async function createAttachmentUpload(
  values: AttachmentUploadValues,
  executor: Executor = db,
) {
  await executor.insert(AttachmentUploads).values(values);
}

export async function deleteOwnedUnattachedAttachmentUpload(
  input: OwnedUnattachedAttachment,
  executor: Executor = db,
) {
  const [deletedAttachmentUploadId] =
    await deleteOwnedUnattachedAttachmentUploads(
      {
        userId: input.userId,
        attachmentUploadIds: [input.attachmentUploadId],
        kind: input.kind,
      },
      executor,
    );

  return deletedAttachmentUploadId ?? null;
}

export async function deleteOwnedUnattachedAttachmentUploads(
  input: OwnedUnattachedAttachments,
  executor: Executor = db,
): Promise<string[]> {
  const attachmentUploadIds = [...new Set(input.attachmentUploadIds)];
  if (attachmentUploadIds.length === 0) return [];

  if (executor === db) {
    return db.transaction((transaction) =>
      deleteOwnedUnattachedAttachmentUploads(input, transaction),
    );
  }

  // Recheck references in a fresh statement after any competing reservation commits.
  await lockOwnedAttachmentUploads(input.userId, attachmentUploadIds, executor);

  const deletedUploads = await executor
    .delete(AttachmentUploads)
    .where(
      ownedUnattachedAttachments({ ...input, attachmentUploadIds }, executor),
    )
    .returning({
      attachmentUploadId: AttachmentUploads.attachmentUploadId,
    });

  return deletedUploads.map((upload) => upload.attachmentUploadId);
}
