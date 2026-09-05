import { eq, notExists } from "drizzle-orm";
import {
  AttachmentUploads,
  ChatMessageAttachments,
  db,
  type Executor,
} from "../db";

export function attachmentUploadIsUnattached(executor: Executor) {
  return notExists(
    executor
      .select({ messageId: ChatMessageAttachments.messageId })
      .from(ChatMessageAttachments)
      .where(
        eq(
          ChatMessageAttachments.attachmentUploadId,
          AttachmentUploads.attachmentUploadId,
        ),
      ),
  );
}

export async function attachUploadsToMessage(
  messageId: string,
  attachmentUploadIds: readonly string[],
  executor: Executor = db,
) {
  if (attachmentUploadIds.length === 0) return;

  await executor.insert(ChatMessageAttachments).values(
    attachmentUploadIds.map((attachmentUploadId, position) => ({
      messageId,
      attachmentUploadId,
      position,
    })),
  );
}
