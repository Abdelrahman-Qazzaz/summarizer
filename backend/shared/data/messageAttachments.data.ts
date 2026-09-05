import { ChatMessageAttachments, db, type Executor } from "../db";

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
