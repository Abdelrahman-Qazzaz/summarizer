import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  AttachmentTurnReservations,
  Attachments,
  Conversations,
  db,
  type Executor,
} from "../db";
import { CLAIM_LEASE_MS } from "./conversations.data";
import { attachmentIsUnattached } from "./messageAttachments.data";

type AttachmentValues = Pick<
  typeof Attachments.$inferInsert,
  | "attachmentId"
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
  attachmentId: string;
  kind: AttachmentValues["kind"];
};

type OwnedUnattachedAttachments = {
  userId: string;
  attachmentIds: readonly string[];
  kind: AttachmentValues["kind"];
};

type OwnedAttachments = {
  userId: string;
  attachmentIds?: readonly string[];
  kind: AttachmentValues["kind"];
};

export function userOwnsAttachments(input: OwnedAttachments) {
  return and(
    eq(Attachments.userId, input.userId),
    eq(Attachments.kind, input.kind),
    input.attachmentIds === undefined
      ? undefined
      : inArray(Attachments.attachmentId, [...input.attachmentIds]),
  );
}

function ownedUnattachedAttachments(
  input: OwnedUnattachedAttachments,
  executor: Executor,
) {
  // A slow provider may outlive the lease while its conversation claim still owns the turn.
  return and(
    userOwnsAttachments(input),
    attachmentIsUnattached(executor),
    sql`not exists (
      select 1 from ${AttachmentTurnReservations}
      where ${AttachmentTurnReservations.attachmentId} = ${Attachments.attachmentId}
        and (${AttachmentTurnReservations.expiresAt} > now() or exists (
          select 1 from ${Conversations}
          where ${Conversations.activeTurnClaimToken} = ${AttachmentTurnReservations.claimToken}
        ))
    )`,
  );
}

async function lockOwnedAttachments(
  userId: string,
  attachmentIds: readonly string[],
  executor: Executor,
) {
  return executor
    .select({ attachmentId: Attachments.attachmentId })
    .from(Attachments)
    .where(
      and(
        eq(Attachments.userId, userId),
        inArray(Attachments.attachmentId, [...attachmentIds]),
      ),
    )
    .orderBy(asc(Attachments.attachmentId))
    .for("update");
}

export async function reserveAttachments(
  userId: string,
  attachmentIds: readonly string[],
  claimToken: string,
) {
  const uniqueAttachmentIds = [...new Set(attachmentIds)];
  if (uniqueAttachmentIds.length === 0) return true;

  return db.transaction(async (transaction) => {
    const attachments = await lockOwnedAttachments(
      userId,
      uniqueAttachmentIds,
      transaction,
    );
    if (attachments.length !== uniqueAttachmentIds.length) return false;

    await transaction.insert(AttachmentTurnReservations).values(
      uniqueAttachmentIds.map((attachmentId) => ({
        attachmentId,
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

export async function createAttachment(
  values: AttachmentValues,
  executor: Executor = db,
) {
  await executor.insert(Attachments).values(values);
}

export async function deleteOwnedUnattachedAttachment(
  input: OwnedUnattachedAttachment,
  executor: Executor = db,
) {
  const [deletedAttachmentId] = await deleteOwnedUnattachedAttachments(
    {
      userId: input.userId,
      attachmentIds: [input.attachmentId],
      kind: input.kind,
    },
    executor,
  );

  return deletedAttachmentId ?? null;
}

export async function deleteOwnedUnattachedAttachments(
  input: OwnedUnattachedAttachments,
  executor: Executor = db,
): Promise<string[]> {
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (attachmentIds.length === 0) return [];

  if (executor === db) {
    return db.transaction((transaction) =>
      deleteOwnedUnattachedAttachments(input, transaction),
    );
  }

  // Recheck references in a fresh statement after any competing reservation commits.
  await lockOwnedAttachments(input.userId, attachmentIds, executor);

  const deletedAttachments = await executor
    .delete(Attachments)
    .where(ownedUnattachedAttachments({ ...input, attachmentIds }, executor))
    .returning({
      attachmentId: Attachments.attachmentId,
    });

  return deletedAttachments.map((attachment) => attachment.attachmentId);
}
