import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  AttachmentTurnReservations,
  Attachments,
  Conversations,
  db,
  type Executor,
} from "../db";
import { CLAIM_LEASE_MS } from "./conversations.data";
import { attachmentIsUnlinked } from "./messageAttachmentLinks.data";

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

type DeleteAttachmentInput = {
  userId: string;
  attachmentId: string;
  kind: AttachmentValues["kind"];
};

type DeleteAttachmentsInput = {
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

function ownedUnlinkedUnreservedAttachments(
  input: DeleteAttachmentsInput,
  executor: Executor,
) {
  return and(
    userOwnsAttachments(input),
    attachmentIsUnlinked(executor),
    attachmentIsUnreserved(),
  );
}

function attachmentIsUnreserved() {
  // A slow provider may outlive the lease while its conversation claim still owns the turn.
  return sql`not exists (
    select 1 from ${AttachmentTurnReservations}
    where ${AttachmentTurnReservations.attachmentId} = ${Attachments.attachmentId}
      and (${AttachmentTurnReservations.expiresAt} > now() or exists (
        select 1 from ${Conversations}
        where ${Conversations.activeTurnClaimToken} = ${AttachmentTurnReservations.claimToken}
      ))
  )`;
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

export async function deleteOwnedUnlinkedUnreservedAttachment(
  input: DeleteAttachmentInput,
  executor: Executor = db,
) {
  const [deletedAttachmentId] = await deleteOwnedUnlinkedUnreservedAttachments(
    {
      userId: input.userId,
      attachmentIds: [input.attachmentId],
      kind: input.kind,
    },
    executor,
  );

  return deletedAttachmentId ?? null;
}

export async function deleteOwnedUnlinkedUnreservedAttachments(
  input: DeleteAttachmentsInput,
  executor: Executor = db,
): Promise<string[]> {
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (attachmentIds.length === 0) return [];

  if (executor === db) {
    return db.transaction((transaction) =>
      deleteOwnedUnlinkedUnreservedAttachments(input, transaction),
    );
  }

  // Recheck references in a fresh statement after any competing reservation commits.
  await lockOwnedAttachments(input.userId, attachmentIds, executor);

  const deletedAttachments = await executor
    .delete(Attachments)
    .where(
      ownedUnlinkedUnreservedAttachments({ ...input, attachmentIds }, executor),
    )
    .returning({
      attachmentId: Attachments.attachmentId,
    });

  return deletedAttachments.map((attachment) => attachment.attachmentId);
}
