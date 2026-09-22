import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import {
  Attachments,
  ChatMessageAttachmentLinks,
  ChatMessages,
  Conversations,
  TranscriptContents,
  db,
  type Executor,
} from "../db";
import { images } from "./images.data";
import { conversations } from "./conversations.data";
import { messageAttachmentLinks } from "./messageAttachmentLinks.data";
import { attachments } from "./attachments.data";
import {
  transcripts,
  type StoredTranscriptAttachment,
} from "./transcripts.data";

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

type MessageCursor = Pick<
  typeof ChatMessages.$inferSelect,
  "id" | "role" | "createdAt"
>;

/**
 * Messages are ordered by (createdAt, role, id), so a cursor comparison has to
 * walk that tuple rather than compare one column. `side` picks the direction:
 * `gt` for what follows the cursor, `lt` for what precedes it.
 */
function messageIsOn(side: typeof gt | typeof lt, cursor: MessageCursor) {
  return or(
    side(ChatMessages.createdAt, cursor.createdAt),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      side(ChatMessages.role, cursor.role),
    ),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      eq(ChatMessages.role, cursor.role),
      side(ChatMessages.id, cursor.id),
    ),
  );
}

const messageIsAfter = (cursor: MessageCursor) => messageIsOn(gt, cursor);
const messageIsBefore = (cursor: MessageCursor) => messageIsOn(lt, cursor);

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
    imageUploadId: string;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
  }[];
};

export type CreateMessageHistory = {
  id: string;
  role: MessageRow["role"];
  content: string;
  createdAt: Date;
  transcriptContents: string[];
  imageUrls: string[];
  contextCharCount: number;
};

type CreateMessageHistoryRow = {
  currentTurnContextCharCount: number;
  currentTranscriptCount: number;
  messageId: string | null;
  role: MessageRow["role"] | null;
  content: string | null;
  createdAt: string | null;
  attachmentId: string | null;
  attachmentKind: "image" | "audio" | null;
  signedUrl: string | null;
  signedUrlExpiresAt: string | null;
  transcriptContent: string | null;
  transcriptCharCount: number | null;
};

type CreateMessageHistoryImage = {
  imageUploadId: string;
  signedUrl: string | null;
  signedUrlExpiresAt: Date | null;
};

type PendingCreateMessageHistory = Omit<CreateMessageHistory, "imageUrls"> & {
  images: CreateMessageHistoryImage[];
};

/** Fully resolved admitted history for POST message creation, newest first. */
export async function findCreateMessageHistory(input: {
  userId: string;
  conversationId: string;
  newMessageContentCharCount: number;
  newTranscriptUploadIds: readonly string[];
  transcriptSeparatorCharCount: number;
  maximumContextCharCount: number;
  maximumMessageCount: number;
  maximumImageCount: number;
  /** Editing a message: take history from before it, not from the tail. */
  beforeMessageId?: string;
}): Promise<CreateMessageHistory[]> {
  const currentTranscriptFilter =
    input.newTranscriptUploadIds.length > 0
      ? inArray(TranscriptContents.audioUploadId, [
          ...input.newTranscriptUploadIds,
        ])
      : sql`false`;

  // Same order as messageIsBefore: created_at, then role, then id.
  const historyBound =
    input.beforeMessageId === undefined
      ? sql``
      : sql`and (
          ${ChatMessages.createdAt},
          ${ChatMessages.role},
          ${ChatMessages.id}
        ) < (
          select
            bound.${sql.identifier(ChatMessages.createdAt.name)},
            bound.${sql.identifier(ChatMessages.role.name)},
            bound.${sql.identifier(ChatMessages.id.name)}
          from ${ChatMessages} as bound
          where bound.${sql.identifier(ChatMessages.id.name)} = ${input.beforeMessageId}
            and bound.${sql.identifier(ChatMessages.conversationId.name)} = ${input.conversationId}
        )`;

  const rows = await db.execute<CreateMessageHistoryRow>(sql`
    with current_turn as (
      select
        (
          ${input.newMessageContentCharCount}
          + coalesce(
              sum(
                ${TranscriptContents.charCount}
                + ${input.transcriptSeparatorCharCount}
              ),
              0
            )
        )::integer as context_char_count,
        count(${TranscriptContents.audioUploadId})::integer as transcript_count
      from ${TranscriptContents}
      inner join ${Attachments}
        on ${Attachments.attachmentId} = ${TranscriptContents.audioUploadId}
        and ${Attachments.userId} = ${input.userId}
        and ${Attachments.kind} = 'audio'
      where ${currentTranscriptFilter}
    ),
    recent_messages as (
      select
        ${ChatMessages.id} as message_id,
        ${ChatMessages.role} as role,
        ${ChatMessages.content} as content,
        ${ChatMessages.createdAt} as created_at
      from ${ChatMessages}
      where ${ChatMessages.conversationId} = ${input.conversationId}
        ${historyBound}
      order by
        ${ChatMessages.createdAt} desc,
        ${ChatMessages.role} desc,
        ${ChatMessages.id} desc
      limit coalesce(
        (
          select greatest(
            0,
            least(
              ${Conversations.contextWindowMessageCount},
              ${input.maximumMessageCount}
            )
          )
          from ${Conversations}
          where ${Conversations.id} = ${input.conversationId}
            and ${Conversations.userId} = ${input.userId}
        ),
        0
      )
    )
    select
      current_turn.context_char_count as "currentTurnContextCharCount",
      current_turn.transcript_count as "currentTranscriptCount",
      recent_messages.message_id as "messageId",
      recent_messages.role as role,
      recent_messages.content as content,
      recent_messages.created_at as "createdAt",
      ${ChatMessageAttachmentLinks.attachmentId} as "attachmentId",
      ${Attachments.kind} as "attachmentKind",
      ${Attachments.signedUrl} as "signedUrl",
      ${Attachments.signedUrlExpiresAt} as "signedUrlExpiresAt",
      ${TranscriptContents.content} as "transcriptContent",
      ${TranscriptContents.charCount} as "transcriptCharCount"
    from current_turn
    left join recent_messages on true
    left join ${ChatMessageAttachmentLinks}
      on ${ChatMessageAttachmentLinks.messageId} = recent_messages.message_id
    left join ${Attachments}
      on ${Attachments.attachmentId} = ${ChatMessageAttachmentLinks.attachmentId}
      and ${Attachments.userId} = ${input.userId}
    left join ${TranscriptContents}
      on ${TranscriptContents.audioUploadId} = ${Attachments.attachmentId}
      and ${Attachments.kind} = 'audio'
    order by
      recent_messages.created_at desc,
      recent_messages.role desc,
      recent_messages.message_id desc,
      ${ChatMessageAttachmentLinks.position} asc
  `);
  const currentTurn = rows[0];
  if (
    !currentTurn ||
    currentTurn.currentTranscriptCount !==
      input.newTranscriptUploadIds.length ||
    currentTurn.currentTurnContextCharCount >= input.maximumContextCharCount
  ) {
    return [];
  }

  const candidates: PendingCreateMessageHistory[] = [];
  const historyByMessageId = new Map<string, PendingCreateMessageHistory>();

  for (const row of rows) {
    if (
      row.messageId === null ||
      row.role === null ||
      row.content === null ||
      row.createdAt === null
    ) {
      continue;
    }

    let message = historyByMessageId.get(row.messageId);
    if (!message) {
      message = {
        id: row.messageId,
        role: row.role,
        content: row.content,
        createdAt: new Date(row.createdAt),
        transcriptContents: [],
        images: [],
        contextCharCount: row.content.length,
      };
      candidates.push(message);
      historyByMessageId.set(row.messageId, message);
    }

    if (row.attachmentKind === "audio" && row.transcriptContent !== null) {
      message.transcriptContents.push(row.transcriptContent);
      message.contextCharCount +=
        (row.transcriptCharCount ?? row.transcriptContent.length) +
        input.transcriptSeparatorCharCount;
    }

    if (row.attachmentKind === "image" && row.attachmentId !== null) {
      message.images.push({
        imageUploadId: row.attachmentId,
        signedUrl: row.signedUrl,
        signedUrlExpiresAt: row.signedUrlExpiresAt
          ? new Date(row.signedUrlExpiresAt)
          : null,
      });
    }
  }

  const history: PendingCreateMessageHistory[] = [];
  let remainingContextCharCount =
    input.maximumContextCharCount - currentTurn.currentTurnContextCharCount;
  for (const message of candidates) {
    if (message.contextCharCount > remainingContextCharCount) break;
    remainingContextCharCount -= message.contextCharCount;
    history.push(message);
  }

  const imageRowsByUploadId = new Map<string, CreateMessageHistoryImage>();
  let remainingImageCount = Math.max(0, input.maximumImageCount);
  for (const message of history) {
    message.images = message.images.slice(0, remainingImageCount);
    remainingImageCount -= message.images.length;
    for (const image of message.images) {
      imageRowsByUploadId.set(image.imageUploadId, image);
    }
  }

  const urlByImageUploadId = await images.resolveImageAttachmentUrls(
    input.userId,
    [...imageRowsByUploadId.values()],
  );

  return history.map(({ images, ...message }) => ({
    ...message,
    imageUrls: images.flatMap((image) => {
      const url = urlByImageUploadId.get(image.imageUploadId);
      return url ? [url] : [];
    }),
  }));
}

async function hydrateContextMessages(
  userId: string,
  recentMessages: Omit<ContextMessage, "transcripts" | "images">[],
): Promise<ContextMessage[]> {
  if (recentMessages.length === 0) return [];
  const messageIds = recentMessages.map((message) => message.id);

  const [imageRows, transcriptionsByMessageId] = await Promise.all([
    db
      .select({
        messageId: ChatMessageAttachmentLinks.messageId,
        imageUploadId: Attachments.attachmentId,
        imageSignedUrl: Attachments.signedUrl,
        imageSignedUrlExpiresAt: Attachments.signedUrlExpiresAt,
      })
      .from(ChatMessageAttachmentLinks)
      .innerJoin(
        Attachments,
        eq(Attachments.attachmentId, ChatMessageAttachmentLinks.attachmentId),
      )
      .where(
        and(
          eq(Attachments.userId, userId),
          eq(Attachments.kind, "image"),
          inArray(ChatMessageAttachmentLinks.messageId, messageIds),
        ),
      )
      .orderBy(
        asc(ChatMessageAttachmentLinks.messageId),
        asc(ChatMessageAttachmentLinks.position),
      ),
    transcripts.findMessageTranscriptAttachments(userId, messageIds),
  ]);

  const imagesByMessageId = new Map<string, ContextMessage["images"]>();
  for (const image of imageRows) {
    if (!image.messageId) continue;
    const images = imagesByMessageId.get(image.messageId) ?? [];
    images.push({
      imageUploadId: image.imageUploadId,
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

  return hydrateContextMessages(userId, recentMessages);
}

async function createMessage(
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

/**
 * Deletes a message and everything after it, moving the conversation head
 * back. A claimed turn blocks it, unless the claim is the caller's own
 * (`claimToken`) — editing a message rewinds under the claim it already holds.
 * `onlyRole` refuses a message of any other role, before anything is deleted.
 */
export async function deleteOwnedMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  options: { claimToken?: string; onlyRole?: MessageRow["role"] } = {},
) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({
        activeTurnClaimToken: Conversations.activeTurnClaimToken,
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
    if (
      conversation.activeTurnClaimToken &&
      conversation.activeTurnClaimToken !== options.claimToken
    )
      return { status: "active" } as const;

    const [targetMessage] = await tx
      .select({
        id: ChatMessages.id,
        role: ChatMessages.role,
        createdAt: ChatMessages.createdAt,
      })
      .from(ChatMessages)
      .where(
        and(
          eq(ChatMessages.id, messageId),
          eq(ChatMessages.conversationId, conversationId),
          eq(ChatMessages.userId, userId),
        ),
      )
      .limit(1);

    if (!targetMessage) return null;
    if (options.onlyRole && targetMessage.role !== options.onlyRole)
      return { status: "wrong_role" } as const;

    const [newHead] = await tx
      .select({ id: ChatMessages.id })
      .from(ChatMessages)
      .where(
        and(
          eq(ChatMessages.conversationId, conversationId),
          eq(ChatMessages.userId, userId),
          messageIsBefore(targetMessage),
        ),
      )
      .orderBy(
        desc(ChatMessages.createdAt),
        desc(ChatMessages.role),
        desc(ChatMessages.id),
      )
      .limit(1);

    const deleteFilter = and(
      eq(ChatMessages.conversationId, conversationId),
      eq(ChatMessages.userId, userId),
      or(eq(ChatMessages.id, targetMessage.id), messageIsAfter(targetMessage)),
    );
    const imageRows = await tx
      .select({ imageUploadId: Attachments.attachmentId })
      .from(ChatMessageAttachmentLinks)
      .innerJoin(
        Attachments,
        eq(Attachments.attachmentId, ChatMessageAttachmentLinks.attachmentId),
      )
      .innerJoin(
        ChatMessages,
        eq(ChatMessageAttachmentLinks.messageId, ChatMessages.id),
      )
      .where(
        and(
          eq(Attachments.userId, userId),
          eq(Attachments.kind, "image"),
          deleteFilter,
        ),
      );

    const deletedMessages = await tx
      .delete(ChatMessages)
      .where(deleteFilter)
      .returning({ id: ChatMessages.id });

    const deletedImageUploadIds =
      await images.deleteOwnedUnlinkedUnreservedImageAttachments(
        userId,
        imageRows.map((image) => image.imageUploadId),
        tx,
      );

    await tx
      .update(Conversations)
      .set({ lastMessageId: newHead?.id ?? null, updatedAt: new Date() })
      .where(
        and(
          eq(Conversations.id, conversationId),
          eq(Conversations.userId, userId),
        ),
      );

    return {
      status: "deleted",
      ids: deletedMessages.map((message) => message.id),
      imageUploadIds: deletedImageUploadIds,
      lastMessageId: newHead?.id ?? null,
    } as const;
  });
}

/**
 * Persists a completed turn as one transaction: the user message, its
 * attachments, the assistant reply, and the conversation's new head.
 * All-or-nothing, so a mid-write failure can't leave a turn half-recorded — a
 * user message with no reply, or a reply the conversation never points at.
 */
export async function persistChatTurn(turn: {
  userId: string;
  conversationId: string;
  content: string;
  attachmentIds: readonly string[];
  chosenModelId: string;
  assistantContent: string;
  conversationTitle?: string;
  contextWindowMessageCount: number;
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
      messageAttachmentLinks.linkAttachmentsToMessage(
        userMessage.id,
        turn.attachmentIds,
        tx,
      ),
    ]);
    const completed = await conversations.completeConversationTurn(
      turn.userId,
      turn.conversationId,
      turn.claimToken,
      assistantMessage.id,
      turn.conversationTitle,
      turn.contextWindowMessageCount,
      tx,
    );
    if (!completed) throw new Error("Conversation turn claim was lost");

    await attachments.unclaimAttachments(turn.claimToken, tx);

    return assistantMessage.id;
  });
}
