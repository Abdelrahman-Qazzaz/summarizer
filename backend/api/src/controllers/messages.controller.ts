import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { createHash } from "node:crypto";
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
import { buildUserTurn, chatAI } from "../../../shared/ai/ai_chat_client";
import type { ChatTurn } from "../../../shared/ai/ai_chat_client";
import { logger } from "../../../shared/logger";
import { findOwnedConversation } from "../data/conversations.data";
import {
  findMessageImageUploadIds,
  resolveImageUploadUrls,
  resolveMessageImages,
  resolveUnattachedImages,
  type ResolvedImage,
} from "../data/images.data";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import {
  findTranscript,
  findTranscriptContents,
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

function toMessageJson(row: MessageRow, attachments: ResolvedImage[] = []) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    chosenModelId: row.chosenModelId,
    conversationId: row.conversationId,
    audioUploadId: row.audioUploadId,
    createdAt: row.createdAt,
    attachments,
  };
}

/**
 * A turn that carried a transcript, as the model sees it: the transcript body
 * followed by what the user actually typed. The stored `content` is only ever
 * the typed part — the transcript is spliced in here, which is what lets one
 * prompt carry a body far past the 50k message cap.
 */
function withTranscript(content: string, transcript: string) {
  return `${transcript}\n\n${content}`;
}

/**
 * The transcript for a turn that names a transcription job, or null when the job
 * isn't the caller's or hasn't finished — a row exists only for a completed one.
 */
async function readTurnTranscript(userId: string, audioUploadId: string) {
  const row = await findTranscript(userId, audioUploadId);
  return row?.content ?? null;
}

/** Assistant turns never carry images, so they're not worth looking up. */
function userMessageIds(
  rows: readonly { id: string; role: MessageRow["role"] }[],
) {
  return rows.filter((row) => row.role === "user").map((row) => row.id);
}

/**
 * A stable fingerprint of the context a reply is generated against: each turn's
 * role and its text. Image URLs are re-signed over time, so they're excluded —
 * the same conversation state must always hash the same. Advisory: it's stored
 * on the conversation and echoed by the client to make drift visible.
 */
function hashContext(turns: ChatTurn[]): string {
  const stable = turns.map((turn) => ({
    role: turn.role,
    text:
      typeof turn.content === "string"
        ? turn.content
        : turn.content
            .map((part) => (part.type === "text" ? part.text : "[image]"))
            .join(""),
  }));
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/**
 * The model context for a new user turn: the conversation's most recent
 * `history` (fetched newest-first by the caller, then reversed here into the
 * oldest-first order the model expects) plus the new turn itself.
 *
 * The new turn is always included, however long it is; history is admitted
 * newest-first until MAX_CONTEXT_CHARS is spent and truncated at the first turn
 * that doesn't fit. A turn's cost is its content length plus its transcript's
 * `charCount` — so the budget is decided without reading any bodies, and only
 * the transcripts that actually fit are then fetched. Images each past turn was
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
    const cost = message.content.length + (message.transcriptCharCount ?? 0);
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
    message.transcriptCharCount !== null && message.audioUploadId
      ? [message.audioUploadId]
      : [],
  );
  const [transcripts, urlByUploadId] = await Promise.all([
    findTranscriptContents(userId, transcriptUploadIds),
    resolveImageUploadUrls(
      userId,
      admitted.flatMap((entry) => entry.imageSlots),
    ),
  ]);

  const turns: ChatTurn[] = [newTurn];
  for (const { message, imageSlots } of admitted) {
    // A past turn's transcript is replayed too — a follow-up about a transcript
    // sent three turns ago has to still see it, same as images.
    let content = message.content;
    if (message.audioUploadId) {
      const transcript = transcripts.get(message.audioUploadId);
      if (transcript) content = withTranscript(content, transcript);
    }

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
  const [owned, rows] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    findConversationMessages(conversationId),
  ]);

  if (!owned) return c.json({ message: "Conversation not found" }, 404);

  const imagesByMessageId = await resolveMessageImages(
    userId,
    userMessageIds(rows),
  );

  return c.json({
    messages: rows.map((row) =>
      toMessageJson(row, imagesByMessageId.get(row.id)),
    ),
  });
}

/**
 * POST /conversations/:conversationId/messages — build the model context, stream
 * the reply over SSE, and persist the turn without the client waiting on it.
 *
 * Events: `delta` ({ delta }) per model chunk, then `hash` ({ contextHash }) — a
 * fingerprint of the context this reply was built on, which the client echoes on
 * its next turn — then `error` ({ message }) if the model call fails. The client
 * consumes this with fetch + response.body.getReader() (EventSource can't POST).
 *
 * The DB writes fire after the reply and are never awaited by the response. The
 * run that produces the reply is decoupled from the response stream, so a client
 * that disconnects mid-stream still has its turn run to completion and saved; GET
 * .../messages is the source of truth.
 */

// look for optimizations after recent rewrite.
export async function handleCreateMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const content: string = c.get(CTX_KEYS.messageContent);
  const chosenModelId: string = c.get(CTX_KEYS.chosenModelId);
  const uploadIds: string[] = c.get(CTX_KEYS.attachmentUploadIds);
  const audioUploadId: string | undefined = c.get(CTX_KEYS.audioUploadId);
  const clientContextHash: string | undefined = c.get(CTX_KEYS.contextHash);

  // Ownership check, attachment resolution, the transcript read and the history
  // fetch are all independent, so they run in one wave; each is simply discarded
  // on the 404 paths, the posture handleListMessages takes for its rows too. The
  // history fetch is bounded by the message cap alone — the stored cutoff only
  // narrows the bucket reads later, not this query.
  const [owned, attachments, transcript, history] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    resolveUnattachedImages(userId, uploadIds),
    audioUploadId ? readTurnTranscript(userId, audioUploadId) : null,
    findRecentMessagesWithContext(
      userId,
      conversationId,
      MAX_CONTEXT_MESSAGES - 1,
    ),
  ]);
  if (!owned) return c.json({ message: "Conversation not found" }, 404);
  // An id that resolved to nothing was never this user's, or was already sent
  // on an earlier message — either way the turn the client asked for can't be
  // built, and silently dropping the image would be worse than saying so.
  if (attachments.length !== uploadIds.length)
    return c.json({ message: "Attachment not found" }, 404);
  // Same posture for the transcript: an id that resolves to nothing is not the
  // user's, hasn't finished transcribing, or its object is unreadable. Sending
  // the prompt without the body it was written about would answer the wrong
  // question.
  if (audioUploadId && !transcript)
    return c.json({ message: "Transcript not found" }, 404);

  // The transcript is the one part of a turn that has no cap of its own —
  // `content` is schema-capped at 50k, images at MAX_CONTEXT_IMAGES, but a
  // transcript is as long as the recording was. Refuse rather than truncate: a
  // silently halved transcript yields a confident answer about the first half.
  if (transcript && transcript.length >= MAX_CONTEXT_CHARS)
    return c.json(
      {
        message: "Transcript is too long for one message",
        maxChars: MAX_CONTEXT_CHARS,
        chars: transcript.length,
      },
      413,
    );

  // Advisory only: a client building on a context we no longer have stored is
  // worth noting, but not worth blocking the turn over yet.
  // TODO: find resolution method.
  if (
    clientContextHash &&
    owned.contextHash &&
    clientContextHash !== owned.contextHash
  )
    log.warn("Client context hash does not match stored", { conversationId });

  const turns = await assembleConversationContext(
    userId,
    history,
    buildUserTurn(
      transcript ? withTranscript(content, transcript) : content,
      attachments.map((attachment) => attachment.url),
    ),
    // Charged up front so history is what falls off to make room for it,
    // rather than the two together silently blowing past the budget.
    (transcript?.length ?? 0) + content.length,
  );

  const contextHash = hashContext(turns);

  // Run once the reply is known; the client never waits on these. The run that
  // produces the reply is decoupled from the response stream (see below), so
  // this still fires even when the client has disconnected mid-stream — an
  // abandoned turn is persisted in full and shows up on GET .../messages.
  const persistTurn = async (assistantContent: string) => {
    try {
      // One transaction, so a mid-write failure rolls the whole turn back rather
      // than leaving a user message with no reply (or vice versa).
      await persistChatTurn({
        userId,
        conversationId,
        content,
        audioUploadId,
        attachmentUploadIds: attachments.map((attachment) => attachment.uploadId),
        chosenModelId,
        assistantContent,
        contextHash,
      });
    } catch (err) {
      // TODO: implement solution
      log.error("Failed to persist chat turn", err, { conversationId });
    }
  };

  // The model run pushes into a queue rather than writing the response stream
  // directly, so it is never coupled to the client's connection. Node doesn't
  // cancel the response when the socket closes — a straight write would resolve
  // until its buffer filled and then block forever, stranding the run. Here the
  // run always completes and persists; only the forwarder below is unblocked by
  // the disconnect signal.
  const events = new SSEEventQueue();
  const disconnectSignal = c.req.raw.signal;

  void (async () => {
    try {
      const assistantContent = await chatAI(chosenModelId, turns, {
        onDelta: async (delta) => events.push("delta", { delta }),
        maxOutputTokens: MAX_RESPONSE_TOKENS,
        // Keeps this conversation's turns on one provider for prompt-cache hits.
        sessionId: conversationId,
      });
      events.push("hash", { contextHash });
      // End the queue before persisting so the response can drain and close —
      // the client waits on the reply, never on the write-back.
      events.end();
      await persistTurn(assistantContent);
    } catch (err) {
      log.error("Chat completion run failed", err, {
        conversationId,
        chosenModelId,
      });
      // Reported in-band: the response is a 200 stream by the time this can
      // fail, so an SSE "error" event is the only channel left to the client.
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

  // Read before the delete: the rows naming these objects cascade with the
  // message. Scoped to this user, so a message they don't own yields nothing.
  const imageUploadIds = await findMessageImageUploadIds(userId, messageId);

  const row = await deleteOwnedMessage(userId, conversationId, messageId);

  if (!row) return c.json({ message: "Message not found" }, 404);

  await deleteFilesFromBucket(userId, imageUploadIds);
  //TODO: move deleteFilesFromBucket to a promise.all with deleteOwnedMessage?
  return c.json({ message: "Message deleted" }, 200);
}
