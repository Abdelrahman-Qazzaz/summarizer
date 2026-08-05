import { and, asc, desc, eq } from "drizzle-orm";
import { ChatMessages, db } from "../../../shared/db";

/**
 * The columns a message is exposed through — every read feeding `toMessageJson`
 * projects exactly these, so `userId` and `updatedAt` never leave the table.
 */
const messageColumns = {
  id: ChatMessages.id,
  role: ChatMessages.role,
  content: ChatMessages.content,
  chosenModelId: ChatMessages.chosenModelId,
  conversationId: ChatMessages.conversationId,
  audioUploadId: ChatMessages.audioUploadId,
  createdAt: ChatMessages.createdAt,
};

export type MessageRow = Pick<
  typeof ChatMessages.$inferSelect,
  keyof typeof messageColumns
>;

/** Full history for a conversation, oldest first. */
export async function findConversationMessages(conversationId: string) {
  return db
    .select(messageColumns)
    .from(ChatMessages)
    .where(eq(ChatMessages.conversationId, conversationId))
    .orderBy(asc(ChatMessages.createdAt), asc(ChatMessages.id));
}

/**
 * The tail of a conversation for model context, newest first so LIMIT keeps the
 * latest turns. Only the fields a prompt is built from.
 */
export async function findRecentMessages(
  conversationId: string,
  limit: number,
) {
  return db
    .select({
      id: ChatMessages.id,
      role: ChatMessages.role,
      content: ChatMessages.content,
      audioUploadId: ChatMessages.audioUploadId,
    })
    .from(ChatMessages)
    .where(eq(ChatMessages.conversationId, conversationId))
    .orderBy(desc(ChatMessages.createdAt), desc(ChatMessages.id))
    .limit(limit);
}

export async function createMessage(message: {
  role: "user" | "assistant";
  content: string;
  conversationId: string;
  userId: string;
  chosenModelId?: string;
  audioUploadId?: string;
}) {
  const [row] = await db
    .insert(ChatMessages)
    .values(message)
    .returning(messageColumns);

  return row;
}

/**
 * Scoped by conversation as well as owner, so a message id from another of the
 * user's conversations doesn't delete through this route. Null when nothing
 * matched, which the caller reports as a 404.
 */
export async function deleteOwnedMessage(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  const [row] = await db
    .delete(ChatMessages)
    .where(
      and(
        eq(ChatMessages.id, messageId),
        eq(ChatMessages.conversationId, conversationId),
        eq(ChatMessages.userId, userId),
      ),
    )
    .returning({ id: ChatMessages.id });

  return row ?? null;
}
