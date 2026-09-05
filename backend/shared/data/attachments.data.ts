import { and, eq } from "drizzle-orm";
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

function ownedUnattachedAttachment(
  input: OwnedUnattachedAttachment,
  executor: Executor,
) {
  return and(
    eq(AttachmentUploads.userId, input.userId),
    eq(AttachmentUploads.attachmentUploadId, input.attachmentUploadId),
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
    .where(ownedUnattachedAttachment(input, executor))
    .limit(1);

  return upload?.attachmentUploadId ?? null;
}

export async function deleteOwnedUnattachedAttachmentUpload(
  input: OwnedUnattachedAttachment,
  executor: Executor = db,
) {
  const [deletedUpload] = await executor
    .delete(AttachmentUploads)
    .where(ownedUnattachedAttachment(input, executor))
    .returning({
      attachmentUploadId: AttachmentUploads.attachmentUploadId,
    });

  return deletedUpload?.attachmentUploadId ?? null;
}
