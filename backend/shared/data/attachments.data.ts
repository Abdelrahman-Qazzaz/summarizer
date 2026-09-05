import { and, eq, inArray } from "drizzle-orm";
import { AttachmentUploads, db, type Executor } from "../db";
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

function ownedUnattachedAttachments(
  input: OwnedUnattachedAttachments,
  executor: Executor,
) {
  return and(
    eq(AttachmentUploads.userId, input.userId),
    inArray(AttachmentUploads.attachmentUploadId, [
      ...input.attachmentUploadIds,
    ]),
    eq(AttachmentUploads.kind, input.kind),
    attachmentUploadIsUnattached(executor),
  );
}

export async function createAttachmentUpload(
  values: AttachmentUploadValues,
  executor: Executor = db,
) {
  await executor.insert(AttachmentUploads).values(values);
}

export async function findOwnedUnattachedAttachmentUploadId(
  input: OwnedUnattachedAttachment,
  executor: Executor = db,
) {
  const [upload] = await executor
    .select({ attachmentUploadId: AttachmentUploads.attachmentUploadId })
    .from(AttachmentUploads)
    .where(
      ownedUnattachedAttachments(
        {
          userId: input.userId,
          attachmentUploadIds: [input.attachmentUploadId],
          kind: input.kind,
        },
        executor,
      ),
    )
    .limit(1);

  return upload?.attachmentUploadId ?? null;
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
) {
  const attachmentUploadIds = [...new Set(input.attachmentUploadIds)];
  if (attachmentUploadIds.length === 0) return [];

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
