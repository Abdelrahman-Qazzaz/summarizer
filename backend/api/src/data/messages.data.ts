import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  ChatMessages,
  Conversations,
  ImageUploads,
  db,
  type Executor,
} from "../../../shared/db";
import { attachImagesToMessage } from "./images.data";
import { completeConversationTurn } from "./conversations.data";
import {
  attachTranscriptionsToMessage,
  findMessageTranscriptAttachments,
  type StoredTranscriptAttachment,
} from "../../../shared/data/transcripts.data";

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
    .orderBy(
      asc(ChatMessages.createdAt),
      asc(ChatMessages.role),
      asc(ChatMessages.id),
    );
}

/** One history turn with everything the prompt is rebuilt from, grouped. */
export type ContextMessage = {
  id: string;
  role: MessageRow["role"];
  content: string;
  createdAt: Date;
  transcripts: StoredTranscriptAttachment[];
  images: {
    uploadId: string;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
  }[];
};

/**
 * The tail of a conversation for model context, newest first so LIMIT keeps the
 * latest turns. Images and transcript metadata are loaded separately after the
 * limit, avoiding a cross-product when a message carries several of each.
 */
export async function findRecentMessagesWithContext(
  userId: string,
  conversationId: string,
  limit: number,
): Promise<ContextMessage[]> {
  const recentMessages = await db
    .select({
      id: ChatMessages.id,
      role: ChatMessages.role,
      content: ChatMessages.content,
      createdAt: ChatMessages.createdAt,
    })
    .from(ChatMessages)
    .where(eq(ChatMessages.conversationId, conversationId))
    .orderBy(
      desc(ChatMessages.createdAt),
      desc(ChatMessages.role),
      desc(ChatMessages.id),
    )
    .limit(limit);

  if (recentMessages.length === 0) return [];
  const messageIds = recentMessages.map((message) => message.id);

  const [imageRows, transcriptionsByMessageId] = await Promise.all([
    db
      .select({
        messageId: ImageUploads.messageId,
        imageUploadId: ImageUploads.uploadId,
        imageSignedUrl: ImageUploads.signedUrl,
        imageSignedUrlExpiresAt: ImageUploads.signedUrlExpiresAt,
      })
      .from(ImageUploads)
      .where(
        and(
          eq(ImageUploads.userId, userId),
          inArray(ImageUploads.messageId, messageIds),
        ),
      )
      .orderBy(asc(ImageUploads.createdAt)),
    findMessageTranscriptAttachments(userId, messageIds),
  ]);

  const imagesByMessageId = new Map<string, ContextMessage["images"]>();
  for (const image of imageRows) {
    if (!image.messageId) continue;
    const images = imagesByMessageId.get(image.messageId) ?? [];
    images.push({
      uploadId: image.imageUploadId,
      signedUrl: image.imageSignedUrl,
      signedUrlExpiresAt: image.imageSignedUrlExpiresAt,
    });
    imagesByMessageId.set(image.messageId, images);
  }

  return recentMessages.map((message) => ({
    ...message,
    transcripts: transcriptionsByMessageId.get(message.id) ?? [],
    images: imagesByMessageId.get(message.id) ?? [],
  }));
}

export async function createMessage(
  message: {
    role: "user" | "assistant";
    content: string;
    conversationId: string;
    userId: string;
    chosenModelId?: string;
  },
  executor: Executor = db,
) {
  const [row] = await executor
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

//TODO: current logic is correct, but needs to stop allowing the deletion of a message from the middle of the chat. Instead, if a user deletes a message, it should delete all the ones that come after it (and are a part of the same branch (in case we want to implement a chat-forking message in the furure)).
export async function deleteOwnedMessage(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({
        activeTurnClaimToken: Conversations.activeTurnClaimToken,
        lastMessageId: Conversations.lastMessageId,
      })
      .from(Conversations)
      .where(
        and(
          eq(Conversations.id, conversationId),
          eq(Conversations.userId, userId),
        ),
      )
      .limit(1)
      .for("update");

    if (!conversation) return null;
    if (conversation.activeTurnClaimToken) return { status: "active" } as const;

    const [deletedMessage] = await tx
      .delete(ChatMessages)
      .where(
        and(
          eq(ChatMessages.id, messageId),
          eq(ChatMessages.conversationId, conversationId),
          eq(ChatMessages.userId, userId),
        ),
      )
      .returning({ id: ChatMessages.id });

    if (!deletedMessage) return null;

    if (conversation.lastMessageId === messageId) {
      const [newHead] = await tx
        .select({ id: ChatMessages.id })
        .from(ChatMessages)
        .where(
          and(
            eq(ChatMessages.conversationId, conversationId),
            eq(ChatMessages.userId, userId),
          ),
        )
        .orderBy(
          desc(ChatMessages.createdAt),
          desc(ChatMessages.role),
          desc(ChatMessages.id),
        )
        .limit(1);

      await tx
        .update(Conversations)
        .set({ lastMessageId: newHead?.id ?? null })
        .where(
          and(
            eq(Conversations.id, conversationId),
            eq(Conversations.userId, userId),
          ),
        );
    }

    return { status: "deleted", id: deletedMessage.id } as const;
  });
}

/**
 * Persists a completed turn as one transaction: the user message, the images it
 * claimed, the assistant reply, and the conversation's new head.
 * All-or-nothing, so a mid-write failure can't leave a turn half-recorded — a
 * user message with no reply, or a reply the conversation never points at.
 */
export async function persistChatTurn(turn: {
  userId: string;
  conversationId: string;
  content: string;
  attachmentUploadIds: readonly string[];
  audioUploadIds: readonly string[];
  chosenModelId: string;
  assistantContent: string;
  conversationTitle?: string;
  claimToken: string;
}) {
  return db.transaction(async (tx) => {
    const userMessage = await createMessage(
      {
        role: "user",
        content: turn.content,
        conversationId: turn.conversationId,
        userId: turn.userId,
      },
      tx,
    );
    const [assistantMessage] = await Promise.all([
      createMessage(
        {
          role: "assistant",
          content: turn.assistantContent,
          chosenModelId: turn.chosenModelId,
          conversationId: turn.conversationId,
          userId: turn.userId,
        },
        tx,
      ),
      attachImagesToMessage(
        turn.userId,
        userMessage.id,
        turn.attachmentUploadIds,
        tx,
      ),
      attachTranscriptionsToMessage(
        userMessage.id,
        turn.audioUploadIds,
        tx,
      ),
    ]);
    const completed = await completeConversationTurn(
      turn.userId,
      turn.conversationId,
      turn.claimToken,
      assistantMessage.id,
      turn.conversationTitle,
      tx,
    );
    if (!completed) throw new Error("Conversation turn claim was lost");

    return assistantMessage.id;
  });
}
