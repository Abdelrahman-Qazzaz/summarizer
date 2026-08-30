// TODO: refactor message creation & patching handlers.

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { SSEEventQueue } from "../utils/sse";
import {
  deleteOwnedMessage,
  findConversationMessages,
  findMessagePatchContext,
  findRecentMessagesWithContext,
  patchOwnedUserMessage,
  persistAssistantMessage,
  persistChatTurn,
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
  attachments: ResolvedImage[] = [],
  transcripts: StoredTranscriptAttachment[] = [],
) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    chosenModelId: row.chosenModelId,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    attachments,
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

type HistoryPreparation =
  { history: ContextMessage[] } | { response: Response };

type PreparedMessageRun = MessageRequest & {
  claimToken: string;
  attachments: ResolvedImage[];
  turns: ChatTurn[];
  releaseClaim: () => Promise<void>;
};

async function prepareMessageRun(
  c: Context,
  request: MessageRequest,
  loaders: {
    attachments: () => Promise<ResolvedImage[]>;
    history: () => Promise<HistoryPreparation>;
  },
): Promise<{ prepared: PreparedMessageRun } | { response: Response }> {
  const claimPromise = claimConversationTurn(
    request.userId,
    request.conversationId,
    request.expectedLastMessageId,
  );

  let requestData;
  try {
    requestData = await Promise.all([
      claimPromise,
      loaders.attachments(),
      request.audioUploadIds.length > 0
        ? findTranscripts(request.userId, request.audioUploadIds)
        : Promise.resolve(new Map<string, string>()),
      loaders.history(),
    ]);
  } catch (error) {
    const acquiredClaimToken = await claimPromise.catch(() => null);
    if (acquiredClaimToken)
      await releaseConversationClaimSafely(
        request.userId,
        request.conversationId,
        acquiredClaimToken,
      );
    throw error;
  }

  const [claimToken, attachments, transcriptsByAudioUploadId, historyResult] =
    requestData;
  if (!claimToken) {
    const ownedConversation = await findOwnedConversation(
      request.userId,
      request.conversationId,
    );
    return {
      response: ownedConversation
        ? c.json(
            {
              message:
                "Conversation changed or a response is already in progress",
            },
            409,
          )
        : c.json({ message: "Conversation not found" }, 404),
    };
  }

  const releaseClaim = () =>
    releaseConversationClaimSafely(
      request.userId,
      request.conversationId,
      claimToken,
    );
  const rejectMessage = async (response: Response) => {
    await releaseClaim();
    return { response } as const;
  };

  try {
    if ("response" in historyResult)
      return rejectMessage(historyResult.response);
    if (attachments.length !== request.imageUploadIds.length)
      return rejectMessage(c.json({ message: "Attachment not found" }, 404));
    if (transcriptsByAudioUploadId.size !== request.audioUploadIds.length)
      return rejectMessage(c.json({ message: "Transcript not found" }, 404));

    const transcripts = request.audioUploadIds.map(
      (audioUploadId) =>
        transcriptsByAudioUploadId.get(audioUploadId) as string,
    );
    const newTurnContent = withTranscripts(request.content, transcripts);
    if (newTurnContent.length >= MAX_CONTEXT_CHARS)
      return rejectMessage(
        c.json(
          {
            message: "Transcripts are too long for one message",
            maxChars: MAX_CONTEXT_CHARS,
            chars: newTurnContent.length,
          },
          413,
        ),
      );

    const turns = await assembleConversationContext(
      request.userId,
      historyResult.history,
      buildUserTurn(
        newTurnContent,
        attachments.map((attachment) => attachment.url),
      ),
      newTurnContent.length,
    );
    if (
      containsImageInput(turns) &&
      !(await validateChatModelInput(request.chosenModelId, "image"))
    )
      return rejectMessage(
        c.json({ message: "Invalid model: must accept image input" }, 400),
      );

    return {
      prepared: {
        ...request,
        claimToken,
        attachments,
        turns,
        releaseClaim,
      },
    };
  } catch (error) {
    await releaseClaim();
    throw error;
  }
}

function streamMessageRun(
  c: Context,
  prepared: PreparedMessageRun,
  persistCompletion: (assistantContent: string) => Promise<string>,
  failure: { message: string; metadata?: Record<string, string> },
) {
  const events = new SSEEventQueue();
  const disconnectSignal = c.req.raw.signal;

  void (async () => {
    try {
      const assistantContent = await chatAI(
        prepared.chosenModelId,
        prepared.turns,
        {
          onDelta: async (delta) => events.push("delta", { delta }),
          maxOutputTokens: MAX_RESPONSE_TOKENS,
          sessionId: prepared.conversationId,
        },
      );
      const lastMessageId = await persistCompletion(assistantContent);
      events.push("done", { lastMessageId });
      events.end();
    } catch (error) {
      await prepared.releaseClaim();
      log.error(failure.message, error, {
        conversationId: prepared.conversationId,
        chosenModelId: prepared.chosenModelId,
        ...failure.metadata,
      });
      events.push("error", { message: "Model response failed" });
      events.end();
    }
  })();

  return streamSSE(c, (stream) => events.pipeTo(stream, disconnectSignal));
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
  const request = messageRequestFrom(c);
  const preparation = await prepareMessageRun(c, request, {
    attachments: () => resolveImages(request.userId, request.imageUploadIds),
    history: async () => ({
      history: await findRecentMessagesWithContext(
        request.userId,
        request.conversationId,
        MAX_CONTEXT_MESSAGES - 1,
      ),
    }),
  });
  if ("response" in preparation) return preparation.response;

  const { prepared } = preparation;
  const conversationTitlePromise =
    prepared.expectedLastMessageId === null
      ? titleForFirstTurn(prepared.content, prepared.conversationId)
      : Promise.resolve(undefined);

  return streamMessageRun(
    c,
    prepared,
    async (assistantContent) =>
      persistChatTurn({
        userId: prepared.userId,
        conversationId: prepared.conversationId,
        content: prepared.content,
        attachmentUploadIds: prepared.attachmentUploadIds,
        chosenModelId: prepared.chosenModelId,
        assistantContent,
        conversationTitle: await conversationTitlePromise,
        claimToken: prepared.claimToken,
      }),
    { message: "Chat completion run failed" },
  );
}

/** PATCH /conversations/:conversationId/messages/:messageId */
export async function handlePatchMessage(c: Context) {
  const request = messageRequestFrom(c);
  const messageId = c.get(CTX_KEYS.messageId);
  const preparation = await prepareMessageRun(c, request, {
    attachments: () => resolveImages(request.userId, request.imageUploadIds),
    history: async () => {
      const patchContext = await findMessagePatchContext(
        request.userId,
        request.conversationId,
        messageId,
        MAX_CONTEXT_MESSAGES - 1,
      );
      if (!patchContext)
        return { response: c.json({ message: "Message not found" }, 404) };
      if (patchContext.target.role !== "user")
        return {
          response: c.json(
            { message: "Only user messages can be edited" },
            400,
          ),
        };
      return { history: patchContext.history };
    },
  });
  if ("response" in preparation) return preparation.response;

  const { prepared } = preparation;
  const rejectPatch = async (response: Response) => {
    await prepared.releaseClaim();
    return response;
  };

  try {
    const patchResult = await patchOwnedUserMessage({
      userId: prepared.userId,
      conversationId: prepared.conversationId,
      messageId,
      content: prepared.content,
      attachmentUploadIds: prepared.attachmentUploadIds,
      claimToken: prepared.claimToken,
    });
    if (patchResult.status === "claim_lost")
      return rejectPatch(
        c.json(
          { message: "Conversation changed or the edit claim was lost" },
          409,
        ),
      );
    if (patchResult.status === "attachments_changed")
      return rejectPatch(
        c.json({ message: "Attachments changed during the edit" }, 409),
      );
    if (patchResult.status === "not_found")
      return rejectPatch(c.json({ message: "Message not found" }, 404));
    if (patchResult.status === "not_user")
      return rejectPatch(
        c.json({ message: "Only user messages can be edited" }, 400),
      );

    await deleteFilesFromBucket(prepared.userId, patchResult.imageUploadIds);

    return streamMessageRun(
      c,
      prepared,
      (assistantContent) =>
        persistAssistantMessage({
          userId: prepared.userId,
          conversationId: prepared.conversationId,
          chosenModelId: prepared.chosenModelId,
          assistantContent,
          claimToken: prepared.claimToken,
        }),
      {
        message: "Chat edit completion run failed",
        metadata: { messageId },
      },
    );
  } catch (error) {
    await prepared.releaseClaim();
    throw error;
  }
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
