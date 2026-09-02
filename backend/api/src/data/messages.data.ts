import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  AttachmentUploads,
  ChatMessageAttachments,
  ChatMessages,
  Conversations,
  TranscriptContents,
  db,
  type Executor,
} from "../../../shared/db";
import {
  deleteOrphanedImageUploads,
  resolveImageUploadUrls,
} from "./images.data";
import { completeConversationTurn } from "./conversations.data";
import { attachUploadsToMessage } from "../../../shared/data/attachments.data";
import {
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

type MessageCursor = Pick<
  typeof ChatMessages.$inferSelect,
  "id" | "role" | "createdAt"
>;

function messageIsAfter(cursor: MessageCursor) {
  return or(
    gt(ChatMessages.createdAt, cursor.createdAt),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      gt(ChatMessages.role, cursor.role),
    ),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      eq(ChatMessages.role, cursor.role),
      gt(ChatMessages.id, cursor.id),
    ),
  );
}

function messageIsBefore(cursor: MessageCursor) {
  return or(
    lt(ChatMessages.createdAt, cursor.createdAt),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      lt(ChatMessages.role, cursor.role),
    ),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      eq(ChatMessages.role, cursor.role),
      lt(ChatMessages.id, cursor.id),
    ),
  );
}

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
  createdAt: Date | null;
  attachmentUploadId: string | null;
  attachmentKind: "image" | "audio" | null;
  signedUrl: string | null;
  signedUrlExpiresAt: Date | null;
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
}): Promise<CreateMessageHistory[]> {
  const currentTranscriptFilter =
    input.newTranscriptUploadIds.length > 0
      ? inArray(TranscriptContents.audioUploadId, [
          ...input.newTranscriptUploadIds,
        ])
      : sql`false`;

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
      inner join ${AttachmentUploads}
        on ${AttachmentUploads.attachmentUploadId} = ${TranscriptContents.audioUploadId}
        and ${AttachmentUploads.userId} = ${input.userId}
        and ${AttachmentUploads.kind} = 'audio'
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
      ${ChatMessageAttachments.attachmentUploadId} as "attachmentUploadId",
      ${AttachmentUploads.kind} as "attachmentKind",
      ${AttachmentUploads.signedUrl} as "signedUrl",
      ${AttachmentUploads.signedUrlExpiresAt} as "signedUrlExpiresAt",
      ${TranscriptContents.content} as "transcriptContent",
      ${TranscriptContents.charCount} as "transcriptCharCount"
    from current_turn
    left join recent_messages on true
    left join ${ChatMessageAttachments}
      on ${ChatMessageAttachments.messageId} = recent_messages.message_id
    left join ${AttachmentUploads}
      on ${AttachmentUploads.attachmentUploadId} = ${ChatMessageAttachments.attachmentUploadId}
      and ${AttachmentUploads.userId} = ${input.userId}
    left join ${TranscriptContents}
      on ${TranscriptContents.audioUploadId} = ${AttachmentUploads.attachmentUploadId}
      and ${AttachmentUploads.kind} = 'audio'
    order by
      recent_messages.created_at desc,
      recent_messages.role desc,
      recent_messages.message_id desc,
      ${ChatMessageAttachments.position} asc
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
        createdAt: row.createdAt,
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

    if (row.attachmentKind === "image" && row.attachmentUploadId !== null) {
      message.images.push({
        imageUploadId: row.attachmentUploadId,
        signedUrl: row.signedUrl,
        signedUrlExpiresAt: row.signedUrlExpiresAt,
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

  const urlByImageUploadId = await resolveImageUploadUrls(input.userId, [
    ...imageRowsByUploadId.values(),
  ]);

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
        messageId: ChatMessageAttachments.messageId,
        imageUploadId: AttachmentUploads.attachmentUploadId,
        imageSignedUrl: AttachmentUploads.signedUrl,
        imageSignedUrlExpiresAt: AttachmentUploads.signedUrlExpiresAt,
      })
      .from(ChatMessageAttachments)
      .innerJoin(
        AttachmentUploads,
        eq(
          AttachmentUploads.attachmentUploadId,
          ChatMessageAttachments.attachmentUploadId,
        ),
      )
      .where(
        and(
          eq(AttachmentUploads.userId, userId),
          eq(AttachmentUploads.kind, "image"),
          inArray(ChatMessageAttachments.messageId, messageIds),
        ),
      )
      .orderBy(
        asc(ChatMessageAttachments.messageId),
        asc(ChatMessageAttachments.position),
      ),
    findMessageTranscriptAttachments(userId, messageIds),
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

/** The target user turn and only the history that precedes it. */
export async function findMessagePatchContext(
  userId: string,
  conversationId: string,
  messageId: string,
  historyLimit: number,
) {
  const [target] = await db
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

  if (!target) return null;

  const recentMessages = await db
    .select({
      id: ChatMessages.id,
      role: ChatMessages.role,
      content: ChatMessages.content,
      createdAt: ChatMessages.createdAt,
    })
    .from(ChatMessages)
    .where(
      and(
        eq(ChatMessages.conversationId, conversationId),
        eq(ChatMessages.userId, userId),
        messageIsBefore(target),
      ),
    )
    .orderBy(
      desc(ChatMessages.createdAt),
      desc(ChatMessages.role),
      desc(ChatMessages.id),
    )
    .limit(historyLimit);

  return {
    target,
    history: await hydrateContextMessages(userId, recentMessages),
  };
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

export async function deleteOwnedMessage(
  userId: string,
  conversationId: string,
  messageId: string,
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
    if (conversation.activeTurnClaimToken) return { status: "active" } as const;

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
      .select({ imageUploadId: AttachmentUploads.attachmentUploadId })
      .from(ChatMessageAttachments)
      .innerJoin(
        AttachmentUploads,
        eq(
          AttachmentUploads.attachmentUploadId,
          ChatMessageAttachments.attachmentUploadId,
        ),
      )
      .innerJoin(
        ChatMessages,
        eq(ChatMessageAttachments.messageId, ChatMessages.id),
      )
      .where(
        and(
          eq(AttachmentUploads.userId, userId),
          eq(AttachmentUploads.kind, "image"),
          deleteFilter,
        ),
      );

    const deletedMessages = await tx
      .delete(ChatMessages)
      .where(deleteFilter)
      .returning({ id: ChatMessages.id });

    const deletedImageUploadIds = await deleteOrphanedImageUploads(
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

/** Replaces one user turn and discards its old reply and linear tail. */
export async function patchOwnedUserMessage(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
  attachmentUploadIds: readonly string[];
  claimToken: string;
}) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: Conversations.id })
      .from(Conversations)
      .where(
        and(
          eq(Conversations.id, input.conversationId),
          eq(Conversations.userId, input.userId),
          eq(Conversations.activeTurnClaimToken, input.claimToken),
        ),
      )
      .limit(1)
      .for("update");

    if (!conversation) return { status: "claim_lost" } as const;

    const [target] = await tx
      .select({
        id: ChatMessages.id,
        role: ChatMessages.role,
        createdAt: ChatMessages.createdAt,
      })
      .from(ChatMessages)
      .where(
        and(
          eq(ChatMessages.id, input.messageId),
          eq(ChatMessages.conversationId, input.conversationId),
          eq(ChatMessages.userId, input.userId),
        ),
      )
      .limit(1);

    if (!target) return { status: "not_found" } as const;
    if (target.role !== "user") return { status: "not_user" } as const;

    if (input.attachmentUploadIds.length > 0) {
      const ownedUploads = await tx
        .select({
          attachmentUploadId: AttachmentUploads.attachmentUploadId,
        })
        .from(AttachmentUploads)
        .where(
          and(
            eq(AttachmentUploads.userId, input.userId),
            inArray(AttachmentUploads.attachmentUploadId, [
              ...input.attachmentUploadIds,
            ]),
          ),
        )
        .for("update");
      if (ownedUploads.length !== input.attachmentUploadIds.length)
        return { status: "attachments_changed" } as const;
    }

    const removedImageRows = await tx
      .select({ imageUploadId: AttachmentUploads.attachmentUploadId })
      .from(ChatMessageAttachments)
      .innerJoin(
        AttachmentUploads,
        eq(
          AttachmentUploads.attachmentUploadId,
          ChatMessageAttachments.attachmentUploadId,
        ),
      )
      .innerJoin(
        ChatMessages,
        eq(ChatMessageAttachments.messageId, ChatMessages.id),
      )
      .where(
        and(
          eq(AttachmentUploads.userId, input.userId),
          eq(AttachmentUploads.kind, "image"),
          eq(ChatMessages.conversationId, input.conversationId),
          or(
            messageIsAfter(target),
            and(
              eq(ChatMessages.id, target.id),
              input.attachmentUploadIds.length > 0
                ? notInArray(ChatMessageAttachments.attachmentUploadId, [
                    ...input.attachmentUploadIds,
                  ])
                : undefined,
            ),
          ),
        ),
      );

    await tx
      .delete(ChatMessages)
      .where(
        and(
          eq(ChatMessages.conversationId, input.conversationId),
          eq(ChatMessages.userId, input.userId),
          messageIsAfter(target),
        ),
      );

    await tx
      .delete(ChatMessageAttachments)
      .where(eq(ChatMessageAttachments.messageId, target.id));
    await attachUploadsToMessage(target.id, input.attachmentUploadIds, tx);

    const deletedImageUploadIds = await deleteOrphanedImageUploads(
      input.userId,
      removedImageRows.map((image) => image.imageUploadId),
      tx,
    );

    await tx
      .update(ChatMessages)
      .set({ content: input.content, updatedAt: new Date() })
      .where(eq(ChatMessages.id, target.id));

    await tx
      .update(Conversations)
      .set({ lastMessageId: target.id, updatedAt: new Date() })
      .where(eq(Conversations.id, input.conversationId));

    return {
      status: "patched",
      imageUploadIds: deletedImageUploadIds,
    } as const;
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
      attachUploadsToMessage(userMessage.id, turn.attachmentUploadIds, tx),
    ]);
    const completed = await completeConversationTurn(
      turn.userId,
      turn.conversationId,
      turn.claimToken,
      assistantMessage.id,
      turn.conversationTitle,
      turn.contextWindowMessageCount,
      tx,
    );
    if (!completed) throw new Error("Conversation turn claim was lost");

    return assistantMessage.id;
  });
}

/** Completes a PATCH turn whose edited user message is already stored. */
export async function persistAssistantMessage(turn: {
  userId: string;
  conversationId: string;
  chosenModelId: string;
  assistantContent: string;
  claimToken: string;
}) {
  return db.transaction(async (tx) => {
    const assistantMessage = await createMessage(
      {
        role: "assistant",
        content: turn.assistantContent,
        chosenModelId: turn.chosenModelId,
        conversationId: turn.conversationId,
        userId: turn.userId,
      },
      tx,
    );
    const completed = await completeConversationTurn(
      turn.userId,
      turn.conversationId,
      turn.claimToken,
      assistantMessage.id,
      undefined,
      undefined,
      tx,
    );
    if (!completed) throw new Error("Conversation turn claim was lost");

    return assistantMessage.id;
  });
}
