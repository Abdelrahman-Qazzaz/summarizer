// TODO: stop referring to ONLY images as attachments. attachments means both in one var, seperated by "kind" attr.
// TODO: refactor and fix patching&deletion handlers.

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { SSEEventQueue } from "../utils/sse";
import {
  deleteOwnedMessage,
  findCreateMessageHistory,
  findConversationMessages,
  findMessagePatchContext,
  patchOwnedUserMessage,
  persistAssistantMessage,
  persistChatTurn,
  type CreateMessageHistory,
  type ContextMessage,
  type MessageRow,
} from "../data/messages.data";
import { CTX_KEYS } from "../../../shared/keys";
import {
  buildUserTurn,
  chatAI,
  generateTitle,
  validateChatModelInput,
} from "../../../shared/ai/ai_chat_client";
import type { ChatTurn } from "../../../shared/ai/ai_chat_client";
import { logger } from "../../../shared/logger";
import {
  claimConversationTurn,
  findOwnedConversation,
  releaseConversationTurn,
} from "../data/conversations.data";
import {
  resolveImageUploadUrls,
  resolveImages,
  resolveMessageImages,
  type ResolvedImage,
} from "../data/images.data";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import {
  findMessageTranscriptAttachments,
  findTranscripts,
  type StoredTranscriptAttachment,
} from "../../../shared/data/transcripts.data";
import type { MessageAttachmentInput } from "../schema/messages.schema";

const log = logger.child({ controller: "messages" });

/**
 * Bounds on what one turn can cost. The message cap alone isn't one: 50 turns
 * of the 50k chars the schema allows is a ~2.5M-char prompt, so the character
 * budget is what actually holds the line. Older turns simply fall off.
 */

const MAX_CONTEXT_MESSAGES = 50;
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
      error: error instanceof Error ? error.message : String(error),
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
  return `${transcripts.join("\n\n")}\n\n${content}`;
}

function turnCharCount(
  content: string,
  transcripts: readonly StoredTranscriptAttachment[],
) {
  return (
    content.length +
    transcripts.reduce(
      (total, transcript) => total + (transcript.charCount ?? 0),
      0,
    )
  );
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

function assembleCreateMessageContext(
  history: readonly CreateMessageHistory[],
  newTurn: ChatTurn,
  spentChars: number,
): ChatTurn[] {
  let charBudget = MAX_CONTEXT_CHARS - spentChars;
  const turns: ChatTurn[] = [newTurn];

  for (const message of history) {
    if (charBudget - message.contextCharCount < 0) break;
    charBudget -= message.contextCharCount;

    const content = withTranscripts(
      message.content,
      message.transcriptContents,
    );
    turns.unshift(
      message.imageUrls.length > 0
        ? buildUserTurn(content, message.imageUrls)
        : { role: message.role, content },
    );
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

/**
 * The model context for a new user turn: the conversation's most recent
 * `history` (fetched newest-first by the caller, then reversed here into the
 * oldest-first order the model expects) plus the new turn itself.
 *
 * The new turn is always included, however long it is; history is admitted
 * newest-first until MAX_CONTEXT_CHARS is spent and truncated at the first turn
 * that doesn't fit. A turn's cost is its content length plus its transcripts'
 * `charCount` values, so the budget is decided without reading any bodies, and
 * only the transcripts that fit are then fetched. Images each past turn was
 * sent with ride along under their own MAX_CONTEXT_IMAGES cap.
 */
async function assembleConversationContext(
  userId: string,
  history: ContextMessage[],
  newTurn: ChatTurn,
  spentChars: number,
): Promise<ChatTurn[]> {
  // First decide which turns fit, spending only content lengths and transcript
  // char counts — no transcript body is read for a turn the budget will drop.
  let charBudget = MAX_CONTEXT_CHARS - spentChars;
  let imageBudget = MAX_CONTEXT_IMAGES;
  const admitted: {
    message: ContextMessage;
    imageSlots: ContextMessage["images"];
  }[] = [];

  for (const message of history) {
    const cost = turnCharCount(message.content, message.transcripts);
    if (charBudget - cost < 0) break;
    charBudget -= cost;

    // Slots, not resolved urls, spend the budget — an image that failed to sign
    // is dropped, the same as it would be on the turn it was first sent.
    const imageSlots = message.images.slice(0, imageBudget);
    imageBudget -= imageSlots.length;
    admitted.push({ message, imageSlots });
  }

  // Only now read the bodies and sign the images — for the admitted turns only.
  const audioUploadIds = admitted.flatMap(({ message }) =>
    message.transcripts.flatMap((transcript) =>
      transcript.charCount !== null ? [transcript.audioUploadId] : [],
    ),
  );
  const [transcripts, urlByImageUploadId] = await Promise.all([
    findTranscripts(userId, audioUploadIds),
    resolveImageUploadUrls(
      userId,
      admitted.flatMap((entry) => entry.imageSlots),
    ),
  ]);

  const turns: ChatTurn[] = [newTurn];
  for (const { message, imageSlots } of admitted) {
    // Past transcripts are replayed so follow-ups can still see them.
    const resolvedTranscripts = message.transcripts.flatMap((transcript) =>
      transcripts.has(transcript.audioUploadId)
        ? [transcripts.get(transcript.audioUploadId) as string]
        : [],
    );
    const content = withTranscripts(message.content, resolvedTranscripts);

    const imageUrls = imageSlots.flatMap((image) => {
      const url = urlByImageUploadId.get(image.imageUploadId);
      return url ? [url] : [];
    });

    turns.unshift(
      imageUrls.length > 0
        ? buildUserTurn(content, imageUrls)
        : { role: message.role, content },
    );
  }

  return turns;
}

/** GET /conversations/:conversationId/messages — full history, oldest first. */
export async function handleListMessages(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  // Ownership check and the rows themselves are independent reads; the rows
  // are simply discarded on the 404 path.
  const [ownedConversation, rows] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    findConversationMessages(conversationId),
  ]);

  if (!ownedConversation)
    return c.json({ message: "Conversation not found" }, 404);

  const messageIds = userMessageIds(rows);
  const [imagesByMessageId, transcriptsByMessageId] = await Promise.all([
    resolveMessageImages(userId, messageIds),
    findMessageTranscriptAttachments(userId, messageIds),
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

async function releaseConversationClaimSafely(
  userId: string,
  conversationId: string,
  claimToken: string,
) {
  try {
    await releaseConversationTurn(userId, conversationId, claimToken);
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
  attachmentUploadIds: string[];
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
    attachmentUploadIds: attachments.map((attachment) =>
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

export async function handleCreateMessage(c: Context) {
  // NEW TURN, memory only: read the request data prepared by middleware.
  const messageInput = messageRequestFrom(c);

  // STARTS BEFORE Promise.all, DB: claim this conversation head for the new turn.
  const claimPromise = claimConversationTurn(
    messageInput.userId,
    messageInput.conversationId,
    messageInput.expectedLastMessageId,
  );

  let requestData;
  try {
    requestData = await Promise.all([
      claimPromise,
      resolveImages(messageInput.userId, messageInput.imageUploadIds),
      findTranscripts(messageInput.userId, messageInput.audioUploadIds),
      findCreateMessageHistory(
        messageInput.userId,
        messageInput.conversationId,
        MAX_CONTEXT_MESSAGES - 1,
        MAX_CONTEXT_IMAGES,
      ),
    ]);
  } catch (error) {
    const acquiredClaimToken = await claimPromise.catch(() => null);
    if (acquiredClaimToken) {
      await releaseConversationClaimSafely(
        messageInput.userId,
        messageInput.conversationId,
        acquiredClaimToken,
      );
    }
    throw error;
  }

  const [
    claimToken,
    resolvedImages,
    transcriptContentsByAudioUploadId,
    history,
  ] = requestData;
  if (!claimToken) {
    const ownedConversation = await findOwnedConversation(
      messageInput.userId,
      messageInput.conversationId,
    );

    return ownedConversation
      ? c.json(
          {
            message:
              "Conversation changed or a response is already in progress",
          },
          409,
        )
      : c.json({ message: "Conversation not found" }, 404);
  }

  const releaseClaim = () =>
    releaseConversationClaimSafely(
      messageInput.userId,
      messageInput.conversationId,
      claimToken,
    );

  let turns: ChatTurn[];
  let newMessageContextCharCount: number;
  try {
    if (resolvedImages.length !== messageInput.imageUploadIds.length) {
      await releaseClaim();
      return c.json({ message: "Image not found" }, 404);
    }
    if (
      transcriptContentsByAudioUploadId.size !==
      messageInput.audioUploadIds.length
    ) {
      await releaseClaim();
      return c.json({ message: "Transcript not found" }, 404);
    }

    const transcripts = messageInput.audioUploadIds.map(
      (audioUploadId) =>
        transcriptContentsByAudioUploadId.get(audioUploadId) as string,
    );

    const newTurnContent = withTranscripts(messageInput.content, transcripts);
    newMessageContextCharCount =
      messageInput.content.length +
      transcripts.reduce((total, transcript) => total + transcript.length, 0);
    if (newTurnContent.length >= MAX_CONTEXT_CHARS) {
      await releaseClaim();
      return c.json(
        {
          message: "Message is too long for one message",
          maxChars: MAX_CONTEXT_CHARS,
          chars: newTurnContent.length,
        },
        413,
      );
    }

    turns = assembleCreateMessageContext(
      history,
      buildUserTurn(
        newTurnContent,
        resolvedImages.map((image) => image.url),
      ),
      newTurnContent.length,
    );
    if (
      containsImageInput(turns) &&
      !(await validateChatModelInput(messageInput.chosenModelId, "image"))
    ) {
      await releaseClaim();
      return c.json({ message: "Invalid model: must accept image input" }, 400);
    }
  } catch (error) {
    await releaseClaim();
    throw error;
  }

  const conversationTitlePromise =
    messageInput.expectedLastMessageId === null
      ? titleForFirstTurn(messageInput.content, messageInput.conversationId)
      : Promise.resolve(undefined);

  const events = new SSEEventQueue();
  const disconnectSignal = c.req.raw.signal;

  void (async () => {
    try {
      const assistantContent = await chatAI(messageInput.chosenModelId, turns, {
        onDelta: async (delta) => events.push("delta", { delta }),
        maxOutputTokens: MAX_RESPONSE_TOKENS,
        sessionId: messageInput.conversationId,
      });

      // AFTER provider, memory only: cache the full history size for the next turn.
      const contextWindowMessageCount = countMessagesInContextWindow([
        assistantContent.length,
        newMessageContextCharCount,
        ...history.map((message) => message.contextCharCount),
      ]);

      // NEW TURN, DB transaction: store user + assistant messages, link uploads,
      // update the conversation head, and clear the claim. History is not written.
      // Inside it, assistant insert + upload links share a Promise.all after user insert.
      const lastMessageId = await persistChatTurn({
        userId: messageInput.userId,
        conversationId: messageInput.conversationId,
        content: messageInput.content,
        attachmentUploadIds: messageInput.attachmentUploadIds,
        chosenModelId: messageInput.chosenModelId,
        assistantContent,
        conversationTitle: await conversationTitlePromise,
        contextWindowMessageCount,
        claimToken,
      });

      // STREAM, memory only: queue completion and close the queue.
      events.push("done", { lastMessageId });
      events.end();
    } catch (error) {
      // CLEANUP, DB: release the claim if generation or persistence fails.
      await releaseClaim();

      // LOG only: record the failed background task.
      log.error("Chat completion run failed", error, {
        conversationId: messageInput.conversationId,
        chosenModelId: messageInput.chosenModelId,
      });

      // STREAM, memory only: queue the failure and close the queue.
      events.push("error", { message: "Model response failed" });
      events.end();
    }
  })();

  // HTTP stream: pipe queued events to the client; no DB or bucket work here.
  return streamSSE(c, (stream) => events.pipeTo(stream, disconnectSignal));
}

/** PATCH /conversations/:conversationId/messages/:messageId */
export async function handlePatchMessage(c: Context) {
  const request = messageRequestFrom(c);
  const messageId = c.get(CTX_KEYS.messageId);
  const claimPromise = claimConversationTurn(
    request.userId,
    request.conversationId,
    request.expectedLastMessageId,
  );

  let requestData;
  try {
    requestData = await Promise.all([
      claimPromise,
      resolveImages(request.userId, request.imageUploadIds),
      request.audioUploadIds.length > 0
        ? findTranscripts(request.userId, request.audioUploadIds)
        : Promise.resolve(new Map<string, string>()),
      findMessagePatchContext(
        request.userId,
        request.conversationId,
        messageId,
        MAX_CONTEXT_MESSAGES - 1,
      ),
    ]);
  } catch (error) {
    const acquiredClaimToken = await claimPromise.catch(() => null);
    if (acquiredClaimToken) {
      await releaseConversationClaimSafely(
        request.userId,
        request.conversationId,
        acquiredClaimToken,
      );
    }
    throw error;
  }

  const [
    claimToken,
    resolvedImages,
    transcriptContentsByAudioUploadId,
    patchContext,
  ] = requestData;
  if (!claimToken) {
    const ownedConversation = await findOwnedConversation(
      request.userId,
      request.conversationId,
    );
    return ownedConversation
      ? c.json(
          {
            message:
              "Conversation changed or a response is already in progress",
          },
          409,
        )
      : c.json({ message: "Conversation not found" }, 404);
  }

  const releaseClaim = () =>
    releaseConversationClaimSafely(
      request.userId,
      request.conversationId,
      claimToken,
    );

  let turns: ChatTurn[];
  try {
    if (!patchContext) {
      await releaseClaim();
      return c.json({ message: "Message not found" }, 404);
    }
    if (patchContext.target.role !== "user") {
      await releaseClaim();
      return c.json({ message: "Only user messages can be edited" }, 400);
    }
    if (resolvedImages.length !== request.imageUploadIds.length) {
      await releaseClaim();
      return c.json({ message: "Attachment not found" }, 404);
    }
    if (
      transcriptContentsByAudioUploadId.size !== request.audioUploadIds.length
    ) {
      await releaseClaim();
      return c.json({ message: "Transcript not found" }, 404);
    }

    const transcripts = request.audioUploadIds.map(
      (audioUploadId) =>
        transcriptContentsByAudioUploadId.get(audioUploadId) as string,
    );
    const newTurnContent = withTranscripts(request.content, transcripts);
    if (newTurnContent.length >= MAX_CONTEXT_CHARS) {
      await releaseClaim();
      return c.json(
        {
          message: "Transcripts are too long for one message",
          maxChars: MAX_CONTEXT_CHARS,
          chars: newTurnContent.length,
        },
        413,
      );
    }

    turns = await assembleConversationContext(
      request.userId,
      patchContext.history,
      buildUserTurn(
        newTurnContent,
        resolvedImages.map((image) => image.url),
      ),
      newTurnContent.length,
    );
    if (
      containsImageInput(turns) &&
      !(await validateChatModelInput(request.chosenModelId, "image"))
    ) {
      await releaseClaim();
      return c.json({ message: "Invalid model: must accept image input" }, 400);
    }

    const patchResult = await patchOwnedUserMessage({
      userId: request.userId,
      conversationId: request.conversationId,
      messageId,
      content: request.content,
      attachmentUploadIds: request.attachmentUploadIds,
      claimToken,
    });
    if (patchResult.status === "claim_lost") {
      await releaseClaim();
      return c.json(
        { message: "Conversation changed or the edit claim was lost" },
        409,
      );
    }
    if (patchResult.status === "attachments_changed") {
      await releaseClaim();
      return c.json({ message: "Attachments changed during the edit" }, 409);
    }
    if (patchResult.status === "not_found") {
      await releaseClaim();
      return c.json({ message: "Message not found" }, 404);
    }
    if (patchResult.status === "not_user") {
      await releaseClaim();
      return c.json({ message: "Only user messages can be edited" }, 400);
    }

    await deleteFilesFromBucket(request.userId, patchResult.imageUploadIds);
  } catch (error) {
    await releaseClaim();
    throw error;
  }

  const events = new SSEEventQueue();
  const disconnectSignal = c.req.raw.signal;

  void (async () => {
    try {
      const assistantContent = await chatAI(request.chosenModelId, turns, {
        onDelta: async (delta) => events.push("delta", { delta }),
        maxOutputTokens: MAX_RESPONSE_TOKENS,
        sessionId: request.conversationId,
      });
      const lastMessageId = await persistAssistantMessage({
        userId: request.userId,
        conversationId: request.conversationId,
        chosenModelId: request.chosenModelId,
        assistantContent,
        claimToken,
      });
      events.push("done", { lastMessageId });
      events.end();
    } catch (error) {
      await releaseClaim();
      log.error("Chat edit completion run failed", error, {
        conversationId: request.conversationId,
        chosenModelId: request.chosenModelId,
        messageId,
      });
      events.push("error", { message: "Model response failed" });
      events.end();
    }
  })();

  return streamSSE(c, (stream) => events.pipeTo(stream, disconnectSignal));
}

/** DELETE /conversations/:conversationId/messages/:messageId */
export async function handleDeleteMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const messageId = c.get(CTX_KEYS.messageId);

  const result = await deleteOwnedMessage(userId, conversationId, messageId);

  if (!result) return c.json({ message: "Message not found" }, 404);
  if (result.status === "active")
    return c.json({ message: "A response is already in progress" }, 409);

  await deleteFilesFromBucket(userId, result.imageUploadIds);
  return c.json({ message: "Message deleted" }, 200);
}
