import { and, asc, desc, eq } from "drizzle-orm";
import {
  ChatMessages,
  ImageUploads,
  TranscriptContents,
  db,
  type Executor,
} from "../../../shared/db";
import { attachImagesToMessage } from "./images.data";
import { recordConversationContext } from "./conversations.data";

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

/** One history turn with everything the prompt is rebuilt from, grouped. */
export type ContextMessage = {
  id: string;
  role: MessageRow["role"];
  content: string;
  createdAt: Date;
  audioUploadId: string | null;
  // Length of the turn's transcript, or null when it carried none — enough to
  // budget the turn without reading the body (fetched later, only if it fits).
  transcriptCharCount: number | null;
  images: {
    uploadId: string;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
  }[];
};

/**
 * The tail of a conversation for model context, newest first so LIMIT keeps the
 * latest turns — in one query. The messages are limited first (a subquery), then
 * left-joined to their image uploads and their transcript's length, so replaying
 * a page costs a single round-trip. Image signatures and the transcript bodies
 * are I/O the caller still resolves — this gathers only what's needed to decide
 * which turns fit. Rows fan out per image and are regrouped by message id.
 */
export async function findRecentMessagesWithContext(
  userId: string,
  conversationId: string,
  limit: number,
): Promise<ContextMessage[]> {
  // TODO: check if its possible to use Promise.all
  const recent = db
    .select({
      id: ChatMessages.id,
      role: ChatMessages.role,
      content: ChatMessages.content,
      audioUploadId: ChatMessages.audioUploadId,
      createdAt: ChatMessages.createdAt,
    })
    .from(ChatMessages)
    .where(eq(ChatMessages.conversationId, conversationId))
    .orderBy(desc(ChatMessages.createdAt), desc(ChatMessages.id))
    .limit(limit)
    .as("recent");

  const rows = await db
    .select({
      id: recent.id,
      role: recent.role,
      content: recent.content,
      createdAt: recent.createdAt,
      audioUploadId: recent.audioUploadId,
      transcriptCharCount: TranscriptContents.charCount,
      imageUploadId: ImageUploads.uploadId,
      imageSignedUrl: ImageUploads.signedUrl,
      imageSignedUrlExpiresAt: ImageUploads.signedUrlExpiresAt,
    })
    .from(recent)
    .leftJoin(
      ImageUploads,
      and(
        eq(ImageUploads.messageId, recent.id),
        eq(ImageUploads.userId, userId),
      ),
    )
    .leftJoin(
      TranscriptContents,
      and(
        eq(TranscriptContents.uploadId, recent.audioUploadId),
        eq(TranscriptContents.userId, userId),
      ),
    )
    .orderBy(
      desc(recent.createdAt),
      desc(recent.id),
      asc(ImageUploads.createdAt),
    );

  const byId = new Map<string, ContextMessage>();
  for (const row of rows) {
    let message = byId.get(row.id);
    if (!message) {
      message = {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
        audioUploadId: row.audioUploadId,
        transcriptCharCount: row.transcriptCharCount,
        images: [],
      };
      byId.set(row.id, message);
    }
    if (row.imageUploadId) {
      message.images.push({
        uploadId: row.imageUploadId,
        signedUrl: row.imageSignedUrl,
        signedUrlExpiresAt: row.imageSignedUrlExpiresAt,
      });
    }
  }

  return [...byId.values()];
}

export async function createMessage(
  message: {
    role: "user" | "assistant";
    content: string;
    conversationId: string;
    userId: string;
    chosenModelId?: string;
    audioUploadId?: string;
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

/**
 * Persists a completed turn as one transaction: the user message, the images it
 * claimed, the assistant reply, and the conversation's new context fingerprint.
 * All-or-nothing, so a mid-write failure can't leave a turn half-recorded — a
 * user message with no reply, or a reply the conversation never points at.
 */
export async function persistChatTurn(turn: {
  userId: string;
  conversationId: string;
  content: string;
  audioUploadId?: string;
  attachmentUploadIds: readonly string[];
  chosenModelId: string;
  assistantContent: string;
  contextHash: string;
}) {
  await db.transaction(async (tx) => {
    const userMessage = await createMessage(
      {
        role: "user",
        content: turn.content,
        conversationId: turn.conversationId,
        userId: turn.userId,
        audioUploadId: turn.audioUploadId,
      },
      tx,
    );
    await attachImagesToMessage(
      turn.userId,
      userMessage.id,
      turn.attachmentUploadIds,
      tx,
    );
    await createMessage(
      {
        role: "assistant",
        content: turn.assistantContent,
        chosenModelId: turn.chosenModelId,
        conversationId: turn.conversationId,
        userId: turn.userId,
      },
      tx,
    );
    await recordConversationContext(
      turn.userId,
      turn.conversationId,
      turn.contextHash,
      tx,
    );
  });
}
