// TODO: stop referring to ONLY images as attachments. attachments means both in one var, seperated by "kind" attr.
// TODO: refactor and fix patching&deletion handlers.

import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { SSEEventQueue } from "../utils/sse";
import {
  deleteOwnedMessage,
  findCreateMessageHistory,
  findConversationMessages,
  persistChatTurn,
  type CreateMessageHistory,
  type MessageRow,
} from "../../../shared/data/messages.data";
import { CTX_KEYS } from "../../../shared/keys";
import {
  buildUserTurn,
  chatAI,
  generateTitle,
  validateChatModelInput,
} from "../../../shared/ai/ai_chat_client";
import type { ChatTurn } from "../../../shared/ai/ai_chat_client";
import { logger, messageOf } from "../../../shared/logger";
import { conversations } from "../../../shared/data/conversations.data";
import { images, type ResolvedImage } from "../../../shared/data/images.data";
import { deleteObjects } from "../../../shared/uploads";
import {
  transcripts,
  type StoredTranscriptAttachment,
} from "../../../shared/data/transcripts.data";
import type { MessageAttachmentInput } from "../schema/messages.schema";
import { attachments } from "../../../shared/data/attachments.data";

const log = logger.child({ controller: "messages" });

/**
 * Bounds on what one turn can cost. The message cap alone isn't one: 50 turns
 * of the 50k chars the schema allows is a ~2.5M-char prompt, so the character
 * budget is what actually holds the line. Older turns simply fall off.
 */

const MAX_CONTEXT_MESSAGES = 50;
/** Exported for the tests that build oversized turns against it. */
export const MAX_CONTEXT_CHARS = 100_000;
export const MAX_RESPONSE_TOKENS = 4_000;

/**
 * Images replayed from history, newest turn first. Attachments outlive the turn
 * they arrived on — a follow-up question about an image the user sent three
 * turns ago has to still see it — but they don't consume the character budget,
 * so this is their own ceiling on what one turn costs.
 */
const MAX_CONTEXT_IMAGES = 8;
const FALLBACK_CONVERSATION_TITLE_CHARS = 80;
const TRANSCRIPT_SEPARATOR = "\n\n";

async function titleForFirstTurn(content: string, conversationId: string) {
  const fallback = content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FALLBACK_CONVERSATION_TITLE_CHARS);

  try {
    return (await generateTitle("conversation", content)) || fallback;
  } catch (error) {
    log.warn("Conversation title generation failed", {
      conversationId,
      error: messageOf(error),
    });
    return fallback;
  }
}

function toMessageJson(
  row: MessageRow,
  images: ResolvedImage[] = [],
  transcripts: StoredTranscriptAttachment[] = [],
) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    chosenModelId: row.chosenModelId,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    attachments: images,
    transcriptAttachments: transcripts.map(
      ({ charCount: _charCount, ...attachment }) => attachment,
    ),
  };
}

function withTranscripts(content: string, transcripts: readonly string[]) {
  if (transcripts.length === 0) return content;
  return `${transcripts.join(TRANSCRIPT_SEPARATOR)}${TRANSCRIPT_SEPARATOR}${content}`;
}

/** Assistant turns never carry images, so they're not worth looking up. */
function userMessageIds(
  rows: readonly { id: string; role: MessageRow["role"] }[],
) {
  return rows.filter((row) => row.role === "user").map((row) => row.id);
}

function containsImageInput(turns: readonly ChatTurn[]) {
  return turns.some(
    (turn) =>
      Array.isArray(turn.content) &&
      turn.content.some((content) => content.type === "image_url"),
  );
}

/**
 * A history turn as the model takes it. Images only ever ride on user turns,
 * so a turn without them keeps whichever role it had.
 */
function toHistoryTurn(
  role: ChatTurn["role"],
  content: string,
  imageUrls: readonly string[],
): ChatTurn {
  return imageUrls.length > 0
    ? buildUserTurn(content, imageUrls)
    : { role, content };
}

function assembleCreateMessageContext(
  history: readonly CreateMessageHistory[],
  newTurn: ChatTurn,
): ChatTurn[] {
  const turns: ChatTurn[] = [newTurn];

  for (const message of history) {
    const content = withTranscripts(
      message.content,
      message.transcriptContents,
    );
    turns.unshift(toHistoryTurn(message.role, content, message.imageUrls));
  }

  return turns;
}

function countMessagesInContextWindow(
  charCountsNewestFirst: readonly number[],
) {
  let charBudget = MAX_CONTEXT_CHARS;
  let messageCount = 0;

  for (const charCount of charCountsNewestFirst) {
    if (messageCount >= MAX_CONTEXT_MESSAGES - 1) break;
    if (charBudget - charCount < 0) break;
    charBudget -= charCount;
    messageCount += 1;
  }

  return messageCount;
}

/** GET /conversations/:conversationId/messages — full history, oldest first. */
export async function handleListMessages(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  // Ownership check and the rows themselves are independent reads; the rows
  // are simply discarded on the 404 path.
  const [ownedConversation, rows] = await Promise.all([
    conversations.findOwnedConversation(userId, conversationId),
    findConversationMessages(conversationId),
  ]);

  if (!ownedConversation)
    return c.json({ message: "Conversation not found" }, 404);

  const messageIds = userMessageIds(rows);
  const [imagesByMessageId, transcriptsByMessageId] = await Promise.all([
    images.resolveMessageImages(userId, messageIds),
    transcripts.findMessageTranscriptAttachments(userId, messageIds),
  ]);

  return c.json({
    lastMessageId: ownedConversation.lastMessageId,
    messages: rows.map((row) =>
      toMessageJson(
        row,
        imagesByMessageId.get(row.id),
        transcriptsByMessageId.get(row.id),
      ),
    ),
  });
}

async function unclaimConversationSafely(
  userId: string,
  conversationId: string,
  claimToken: string,
) {
  try {
    await conversations.unclaimConversationTurn(
      userId,
      conversationId,
      claimToken,
    );
  } catch (error) {
    log.error("Failed to release conversation turn claim", error, {
      conversationId,
    });
  }
}

type MessageRequest = {
  userId: string;
  conversationId: string;
  content: string;
  chosenModelId: string;
  attachmentIds: string[];
  imageUploadIds: string[];
  audioUploadIds: string[];
  expectedLastMessageId: string | null;
};

function messageRequestFrom(c: Context): MessageRequest {
  const attachments: MessageAttachmentInput[] = c.get(
    CTX_KEYS.messageAttachmentsIds,
  );
  return {
    userId: c.get(CTX_KEYS.userId),
    conversationId: c.get(CTX_KEYS.conversationId),
    content: c.get(CTX_KEYS.messageContent),
    chosenModelId: c.get(CTX_KEYS.chosenModelId),
    attachmentIds: attachments.map((attachment) =>
      attachment.type === "image"
        ? attachment.imageUploadId
        : attachment.audioUploadId,
    ),
    imageUploadIds: attachments.flatMap((attachment) =>
      attachment.type === "image" ? [attachment.imageUploadId] : [],
    ),
    audioUploadIds: attachments.flatMap((attachment) =>
      attachment.type === "transcript" ? [attachment.audioUploadId] : [],
    ),
    expectedLastMessageId: c.get(CTX_KEYS.lastMessageId),
  };
}

class MessageRequestError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413,
    readonly body: { message: string; maxChars?: number; chars?: number },
  ) {
    super(body.message);
  }
}

/**
 * POST /conversations/:conversationId/messages — build the model context, stream
 * the reply over SSE, and persist the turn without the client waiting on it.
 *
 * Events: `delta` ({ delta }) per model chunk, then `done` ({ lastMessageId })
 * after the completed turn is stored, or `error` ({ message }) if the model call
 * fails. The client consumes this with fetch + response.body.getReader()
 * (EventSource can't POST).
 *
 * The run that produces the reply is decoupled from the response stream, so a
 * client that disconnects mid-stream still has its turn run to completion and
 * saved; GET .../messages is the source of truth.
 */

function mergeTranscriptsIntoContent(
  messageInput: MessageRequest,
  transcriptContentsByAudioUploadId: Map<string, string>,
) {
  const transcripts = messageInput.audioUploadIds.map(
    (audioUploadId) =>
      transcriptContentsByAudioUploadId.get(audioUploadId) as string,
  );
  return withTranscripts(messageInput.content, transcripts);
}

type PreparedTurn = {
  turns: ChatTurn[];
  history: CreateMessageHistory[];
  newMessageContextCharCount: number;
};

/**
 * Settles the claim, the reservations and everything the turn reads in one
 * batch, then checks all of it. Throws a MessageRequestError for anything
 * that stops the turn. `beforeMessageId` takes the history from before a
 * message instead of from the tail: an edit replaces that message and
 * everything after it, so none of it is context.
 */
async function prepareMessageTurn(
  messageInput: MessageRequest,
  claimPromises: readonly [Promise<string | null>, Promise<boolean>],
  beforeMessageId?: string,
): Promise<PreparedTurn> {
  const [
    acquiredClaimToken,
    attachmentsReserved,
    resolvedImages,
    transcriptContentsByAudioUploadId,
    history,
  ] = await Promise.all([
    ...claimPromises,
    images.resolveImages(messageInput.userId, messageInput.imageUploadIds),
    transcripts.findTranscripts(
      messageInput.userId,
      messageInput.audioUploadIds,
    ),
    findCreateMessageHistory({
      userId: messageInput.userId,
      conversationId: messageInput.conversationId,
      newMessageContentCharCount: messageInput.content.length,
      newTranscriptUploadIds: messageInput.audioUploadIds,
      transcriptSeparatorCharCount: TRANSCRIPT_SEPARATOR.length,
      maximumContextCharCount: MAX_CONTEXT_CHARS,
      maximumMessageCount: MAX_CONTEXT_MESSAGES - 1,
      maximumImageCount: MAX_CONTEXT_IMAGES,
      ...(beforeMessageId === undefined ? {} : { beforeMessageId }),
    }),
  ]);

  if (!acquiredClaimToken) {
    const ownedConversation = await conversations.findOwnedConversation(
      messageInput.userId,
      messageInput.conversationId,
    );
    throw ownedConversation
      ? new MessageRequestError(409, {
          message: "Conversation changed or a response is already in progress",
        })
      : new MessageRequestError(404, { message: "Conversation not found" });
  }
  if (resolvedImages.length !== messageInput.imageUploadIds.length) {
    throw new MessageRequestError(404, { message: "Image not found" });
  }
  if (
    transcriptContentsByAudioUploadId.size !==
    messageInput.audioUploadIds.length
  ) {
    throw new MessageRequestError(404, { message: "Transcript not found" });
  }

  const newTurnContent = mergeTranscriptsIntoContent(
    messageInput,
    transcriptContentsByAudioUploadId,
  );
  const newMessageContextCharCount = newTurnContent.length;
  if (newTurnContent.length >= MAX_CONTEXT_CHARS) {
    throw new MessageRequestError(413, {
      message: "Message is too long for one message",
      maxChars: MAX_CONTEXT_CHARS,
      chars: newTurnContent.length,
    });
  }

  const turns = assembleCreateMessageContext(
    history,
    buildUserTurn(
      newTurnContent,
      resolvedImages.map((image) => image.url),
    ),
  );
  if (
    containsImageInput(turns) &&
    !(await validateChatModelInput(messageInput.chosenModelId, "image"))
  ) {
    throw new MessageRequestError(400, {
      message: "Invalid model: must accept image input",
    });
  }
  if (!attachmentsReserved) {
    throw new MessageRequestError(404, { message: "Attachment not found" });
  }

  return { turns, history, newMessageContextCharCount };
}

/**
 * Drops a message and everything after it, under the claim this turn already
 * holds, and releases the images that lose their last link. Only a user
 * message can be replaced; the check happens before anything is deleted.
 */
async function deleteMessageTail(
  messageInput: MessageRequest,
  claimToken: string,
  messageId: string,
) {
  const rewound = await deleteOwnedMessage(
    messageInput.userId,
    messageInput.conversationId,
    messageId,
    { claimToken, onlyRole: "user" },
  );

  if (!rewound) {
    throw new MessageRequestError(404, { message: "Message not found" });
  }
  if (rewound.status === "wrong_role") {
    throw new MessageRequestError(400, {
      message: "Only user messages can be edited",
    });
  }
  if (rewound.status === "active") {
    throw new MessageRequestError(409, {
      message: "A response is already in progress",
    });
  }

  await deleteObjects(
    messageInput.userId,
    rewound.imageUploadIds.map((uploadId) => ({
      kind: "image" as const,
      uploadId,
    })),
  );
}

/**
 * Streams the answer and stores the turn, and owns the claim throughout:
 * whatever `prepareTurn` and the run do, the claim and reservations are released
 * at the end. `prepareTurn` settles everything the turn needs and throws if it
 * can't run, so nothing it destroys (an edit's rewind) is destroyed for a turn
 * that was never going to happen.
 */
function streamAndPersistMessageTurn(
  c: Context,
  messageInput: MessageRequest,
  claimPromises: readonly [Promise<string | null>, Promise<boolean>],
  claimToken: string,
  prepareTurn: () => Promise<PreparedTurn>,
) {
  const responseReady = Promise.withResolvers<Response>();

  // The HTTP response can be ready before the task that owns the claims finishes.
  void (async () => {
    const events = new SSEEventQueue();
    let streamResponse: Response | undefined;

    try {
      const { turns, history, newMessageContextCharCount } =
        await prepareTurn();

      streamResponse = streamSSE(c, (stream) =>
        events.pipeTo(stream, c.req.raw.signal),
      );
      responseReady.resolve(streamResponse);

      const conversationTitlePromise =
        messageInput.expectedLastMessageId === null
          ? titleForFirstTurn(messageInput.content, messageInput.conversationId)
          : Promise.resolve(undefined);
      const assistantContent = await chatAI(messageInput.chosenModelId, turns, {
        onDelta: async (delta) => {
          events.push("delta", { delta });
        },
        maxOutputTokens: MAX_RESPONSE_TOKENS,
        sessionId: messageInput.conversationId,
      });
      const contextWindowMessageCount = countMessagesInContextWindow([
        assistantContent.length,
        newMessageContextCharCount,
        ...history.map((message) => message.contextCharCount),
      ]);
      const lastMessageId = await persistChatTurn({
        userId: messageInput.userId,
        conversationId: messageInput.conversationId,
        content: messageInput.content,
        attachmentIds: messageInput.attachmentIds,
        chosenModelId: messageInput.chosenModelId,
        assistantContent,
        conversationTitle: await conversationTitlePromise,
        contextWindowMessageCount,
        claimToken,
      });

      events.push("done", { lastMessageId });
      return streamResponse;
    } catch (error) {
      if (!streamResponse) {
        if (error instanceof MessageRequestError) {
          return c.json(error.body, error.status);
        }
        throw error;
      }

      events.push("error", { message: "Model response failed" });
      return streamResponse;
    } finally {
      // A failed read does not cancel acquisition; settle it before releasing anything.
      await Promise.allSettled(claimPromises);
      await attachments.unclaimAttachments(claimToken).catch(() => {});
      await unclaimConversationSafely(
        messageInput.userId,
        messageInput.conversationId,
        claimToken,
      );
      events.end();
    }
  })().then(responseReady.resolve, responseReady.reject);

  return responseReady.promise;
}

function createClaimData(messageInput: MessageRequest) {
  const claimToken = randomUUID();
  const claimPromises = [
    conversations.claimConversationTurn(
      messageInput.userId,
      messageInput.conversationId,
      messageInput.expectedLastMessageId,
      claimToken,
    ),
    attachments.claimAttachments(
      messageInput.userId,
      messageInput.attachmentIds,
      claimToken,
    ),
  ] as const;

  return [claimToken, claimPromises] as const;
}
export async function handleCreateMessage(c: Context) {
  const messageInput = messageRequestFrom(c);
  const [claimToken, claimPromises] = createClaimData(messageInput);

  return streamAndPersistMessageTurn(
    c,
    messageInput,
    claimPromises,
    claimToken,
    async () => {
      const prepared = await prepareMessageTurn(messageInput, claimPromises);

      return prepared;
    },
  );
}

/**
 * PATCH /conversations/:conversationId/messages/:messageId — replace a message
 * and everything after it with a fresh turn. The claim is taken up front, the
 * new turn is validated, and only then is the old tail dropped, so a request
 * that would be rejected takes nothing with it. The replacement is a new
 * message; the edited one is gone.
 */
export async function handlePatchMessage(c: Context) {
  const messageInput = messageRequestFrom(c);
  const messageId = c.get(CTX_KEYS.messageId);
  const [claimToken, claimPromises] = createClaimData(messageInput);

  return streamAndPersistMessageTurn(
    c,
    messageInput,
    claimPromises,
    claimToken,
    async () => {
      const prepared = await prepareMessageTurn(
        messageInput,
        claimPromises,
        messageId,
      );
      await deleteMessageTail(messageInput, claimToken, messageId);
      return prepared;
    },
  );
}

/** DELETE /conversations/:conversationId/messages/:messageId */
export async function handleDeleteMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const messageId = c.get(CTX_KEYS.messageId);

  const result = await deleteOwnedMessage(userId, conversationId, messageId);

  if (!result) return c.json({ message: "Message not found" }, 404);
  // Without `onlyRole` the only other outcome is a claimed turn.
  if (result.status !== "deleted")
    return c.json({ message: "A response is already in progress" }, 409);

  await deleteObjects(
    userId,
    result.imageUploadIds.map((uploadId) => ({ kind: "image", uploadId })),
  );
  return c.json({ message: "Message deleted" }, 200);
}
