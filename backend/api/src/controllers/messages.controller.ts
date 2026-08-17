import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { SSEEventQueue } from "../utils/sse";
import {
  deleteOwnedMessage,
  findConversationMessages,
  findRecentMessagesWithContext,
  persistChatTurn,
  type ContextMessage,
  type MessageRow,
} from "../data/messages.data";
import { CTX_KEYS } from "../../../shared/keys";
import {
  buildUserTurn,
  chatAI,
  generateTitle,
} from "../../../shared/ai/ai_chat_client";
import type { ChatTurn } from "../../../shared/ai/ai_chat_client";
import { logger } from "../../../shared/logger";
import {
  claimConversationTurn,
  findOwnedConversation,
  releaseConversationTurn,
} from "../data/conversations.data";
import {
  findMessageImageUploadIds,
  resolveImageUploadUrls,
  resolveMessageImages,
  resolveUnattachedImages,
  type ResolvedImage,
} from "../data/images.data";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import {
  findMessageTranscriptAttachments,
  findTranscripts,
  type StoredTranscriptAttachment,
} from "../../../shared/data/transcripts.data";

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
  const transcriptUploadIds = admitted.flatMap(({ message }) =>
    message.transcripts.flatMap((transcript) =>
      transcript.charCount !== null ? [transcript.uploadId] : [],
    ),
  );
  const [transcripts, urlByUploadId] = await Promise.all([
    findTranscripts(userId, transcriptUploadIds),
    resolveImageUploadUrls(
      userId,
      admitted.flatMap((entry) => entry.imageSlots),
    ),
  ]);

  const turns: ChatTurn[] = [newTurn];
  for (const { message, imageSlots } of admitted) {
    // Past transcripts are replayed so follow-ups can still see them.
    const resolvedTranscripts = message.transcripts.flatMap((transcript) =>
      transcripts.has(transcript.uploadId)
        ? [transcripts.get(transcript.uploadId) as string]
        : [],
    );
    const content = withTranscripts(message.content, resolvedTranscripts);

    const imageUrls = imageSlots.flatMap((image) => {
      const url = urlByUploadId.get(image.uploadId);
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

// look for optimizations after recent rewrite.
export async function handleCreateMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const content: string = c.get(CTX_KEYS.messageContent);
  const chosenModelId: string = c.get(CTX_KEYS.chosenModelId);
  const uploadIds: string[] = c.get(CTX_KEYS.attachmentUploadIds);
  const audioUploadIds: string[] = c.get(CTX_KEYS.audioUploadIds);
  const expectedLastMessageId: string | null = c.get(CTX_KEYS.lastMessageId);

  const claimPromise = claimConversationTurn(
    userId,
    conversationId,
    expectedLastMessageId,
  );

  let requestData;
  try {
    requestData = await Promise.all([
      claimPromise,
      resolveUnattachedImages(userId, uploadIds),
      audioUploadIds.length > 0
        ? findTranscripts(userId, audioUploadIds)
        : Promise.resolve(new Map<string, string>()),
      findRecentMessagesWithContext(
        userId,
        conversationId,
        MAX_CONTEXT_MESSAGES - 1,
      ),
    ]);
  } catch (error) {
    const acquiredClaimToken = await claimPromise.catch(() => null);
    if (acquiredClaimToken)
      await releaseConversationClaimSafely(
        userId,
        conversationId,
        acquiredClaimToken,
      );
    throw error;
  }

  const [claimToken, attachments, transcriptsByAudioUploadId, history] =
    requestData;
  if (!claimToken) {
    const ownedConversation = await findOwnedConversation(
      userId,
      conversationId,
    );
    if (!ownedConversation)
      return c.json({ message: "Conversation not found" }, 404);
    return c.json(
      { message: "Conversation changed or a response is already in progress" },
      409,
    );
  }

  const releaseClaim = () =>
    releaseConversationClaimSafely(userId, conversationId, claimToken);
  const rejectMessage = async (response: Response) => {
    await releaseClaim();
    return response;
  };

  try {
    if (attachments.length !== uploadIds.length)
      return rejectMessage(c.json({ message: "Attachment not found" }, 404));
    if (transcriptsByAudioUploadId.size !== audioUploadIds.length)
      return rejectMessage(c.json({ message: "Transcript not found" }, 404));

    const transcripts = audioUploadIds.map(
      (audioUploadId) =>
        transcriptsByAudioUploadId.get(audioUploadId) as string,
    );
    const newTurnContent = withTranscripts(content, transcripts);
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
      userId,
      history,
      buildUserTurn(
        newTurnContent,
        attachments.map((attachment) => attachment.url),
      ),
      newTurnContent.length,
    );

    const events = new SSEEventQueue();
    const disconnectSignal = c.req.raw.signal;

    void (async () => {
      try {
        const [assistantContent, conversationTitle] = await Promise.all([
          chatAI(chosenModelId, turns, {
            onDelta: async (delta) => events.push("delta", { delta }),
            maxOutputTokens: MAX_RESPONSE_TOKENS,
            sessionId: conversationId,
          }),
          expectedLastMessageId === null
            ? titleForFirstTurn(content, conversationId)
            : Promise.resolve(undefined),
        ]);
        const lastMessageId = await persistChatTurn({
          userId,
          conversationId,
          content,
          attachmentUploadIds: attachments.map(
            (attachment) => attachment.uploadId,
          ),
          audioUploadIds,
          chosenModelId,
          assistantContent,
          conversationTitle,
          claimToken,
        });
        events.push("done", { lastMessageId });
        events.end();
      } catch (error) {
        await releaseClaim();
        log.error("Chat completion run failed", error, {
          conversationId,
          chosenModelId,
        });
        events.push("error", { message: "Model response failed" });
        events.end();
      }
    })();

    return streamSSE(c, (stream) => events.pipeTo(stream, disconnectSignal));
  } catch (error) {
    await releaseClaim();
    throw error;
  }
}

/** DELETE /conversations/:conversationId/messages/:messageId */
export async function handleDeleteMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const messageId = c.get(CTX_KEYS.messageId);

  // Read before the delete: the rows naming these objects cascade with the
  // message. Scoped to this user, so a message they don't own yields nothing.
  const imageUploadIds = await findMessageImageUploadIds(userId, messageId);

  const result = await deleteOwnedMessage(userId, conversationId, messageId);

  if (!result) return c.json({ message: "Message not found" }, 404);
  if (result.status === "active")
    return c.json({ message: "A response is already in progress" }, 409);

  await deleteFilesFromBucket(userId, imageUploadIds);
  //TODO: move deleteFilesFromBucket to a promise.all with deleteOwnedMessage?
  return c.json({ message: "Message deleted" }, 200);
}
