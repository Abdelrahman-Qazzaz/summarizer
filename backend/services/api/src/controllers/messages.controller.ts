import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  createMessage,
  deleteOwnedMessage,
  findConversationMessages,
  findRecentMessages,
  type MessageRow,
} from "../data/messages.data";
import { CTX_KEYS } from "../../../../shared/keys";
import { buildUserTurn, chatAI } from "../../../../shared/ai/ai_client";
import type { ChatTurn } from "../../../../shared/ai/ai_client";
import { SSEEventQueue } from "../utils/sse";
import { logger } from "../../../../shared/logger";
import {
  findOwnedConversation,
  touchConversation,
} from "../data/conversations.data";
import {
  attachImagesToMessage,
  findMessageImageUploadIds,
  resolveMessageImages,
  resolveUnattachedImages,
  type ResolvedImage,
} from "../data/images.data";
import {
  deleteFilesFromBucket,
  readTextFile,
} from "../../../../shared/bucket";
import { findOwnedTranscript } from "../../../../shared/data/jobs.data";
import { tryCatch } from "../../../../shared/try-catch";
import type { UploadId } from "../../../../shared/types/mq.types";

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
 * the typed part — the transcript lives in the bucket and is spliced in here,
 * which is what lets one prompt carry a body far past the 50k message cap.
 */
function withTranscript(content: string, transcript: string) {
  return `${transcript}\n\n${content}`;
}

/**
 * The transcript for a turn that names a transcription job, or null when the
 * job isn't the caller's, hasn't finished, or its object can't be read. A
 * bucket failure is logged rather than thrown: on the history path the turn is
 * still worth replaying without it.
 */
async function readTurnTranscript(userId: string, audioUploadId: string) {
  const job = await findOwnedTranscript(userId, audioUploadId);
  if (!job || job.status !== "completed" || !job.transcriptUploadId) {
    return null;
  }

  const { data, error } = await tryCatch(
    readTextFile(userId, job.transcriptUploadId as UploadId),
  );
  if (error)
    log.error("Failed to read transcript from bucket", error, {
      audioUploadId,
      transcriptUploadId: job.transcriptUploadId,
    });
  return data;
}

/** Assistant turns never carry images, so they're not worth looking up. */
function userMessageIds(
  rows: readonly { id: string; role: MessageRow["role"] }[],
) {
  return rows.filter((row) => row.role === "user").map((row) => row.id);
}

/**
 * The model context for a new user turn: the conversation's most recent
 * history (fetched newest-first so LIMIT keeps the latest turns, then reversed
 * into the oldest-first order the model expects) plus the new turn itself.
 * Must run before the new turn is inserted, so it can't appear twice.
 *
 * The new turn is always included, however long it is; history is admitted
 * newest-first until MAX_CONTEXT_CHARS is spent and truncated at the first turn
 * that doesn't fit — dropping that one but keeping older ones would splice the
 * conversation into something the model reads as a non-sequitur. Images each
 * past turn was sent with ride along under their own MAX_CONTEXT_IMAGES cap.
 */
async function assembleConversationContext(
  userId: string,
  conversationId: string,
  newTurn: ChatTurn,
  spentChars: number,
): Promise<ChatTurn[]> {
  const history = await findRecentMessages(
    conversationId,
    MAX_CONTEXT_MESSAGES - 1,
  );

  const imagesByMessageId = await resolveMessageImages(
    userId,
    userMessageIds(history),
  );

  const turns: ChatTurn[] = [newTurn];
  let charBudget = MAX_CONTEXT_CHARS - spentChars;
  let imageBudget = MAX_CONTEXT_IMAGES;

  for (const message of history) {
    charBudget -= message.content.length;
    if (charBudget < 0) break;

    // A past turn's transcript is replayed too — a follow-up question about a
    // transcript sent three turns ago has to still see it, same as images. It
    // is read only once the budget can still hold something, so a spent budget
    // costs no bucket round-trips.
    let content = message.content;
    if (message.audioUploadId) {
      const transcript = await readTurnTranscript(
        userId,
        message.audioUploadId,
      );
      if (transcript) {
        charBudget -= transcript.length;
        if (charBudget < 0) break;
        content = withTranscript(content, transcript);
      }
    }

    const images = (imagesByMessageId.get(message.id) ?? []).slice(
      0,
      imageBudget,
    );
    imageBudget -= images.length;

    turns.unshift(
      images.length > 0
        ? buildUserTurn(
            content,
            images.map((image) => image.url),
          )
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
 * Persists the user turn, runs the model, and persists the reply, reporting
 * progress into `events`. Never rejects: failures become an `error` event.
 *
 * Deliberately takes a queue rather than the response stream — the run has to
 * finish (and both rows have to land) whether or not a client is still reading.
 */
async function runChatTurn(
  args: {
    userId: string;
    conversationId: string;
    content: string;
    chosenModelId: string;
    turns: ChatTurn[];
    attachments: ResolvedImage[];
    audioUploadId?: string;
  },
  events: SSEEventQueue,
) {
  const {
    userId,
    conversationId,
    content,
    chosenModelId,
    turns,
    attachments,
    audioUploadId,
  } = args;
  try {
    // The user turn must be durable (and its id known for the event) before the
    // model call; touching the conversation surfaces it in the list's ordering.
    // Only the typed content is stored — the transcript stays in the bucket and
    // is spliced back in whenever this turn is replayed.
    const [userMessage] = await Promise.all([
      createMessage({
        role: "user",
        content,
        conversationId,
        userId,
        audioUploadId,
      }),
      touchConversation(userId, conversationId),
    ]);

    // Only now does the message id these uploads hang off exist.
    await attachImagesToMessage(
      userId,
      userMessage.id,
      attachments.map((attachment) => attachment.uploadId),
    );
    events.push("user_message", toMessageJson(userMessage, attachments));

    const full = await chatAI(chosenModelId, turns, {
      onDelta: (delta) => events.push("delta", { delta }),
      maxOutputTokens: MAX_RESPONSE_TOKENS,
    });

    const assistantMessage = await createMessage({
      role: "assistant",
      content: full,
      chosenModelId,
      conversationId,
      userId,
    });

    events.push("done", toMessageJson(assistantMessage));
  } catch (err) {
    log.error("Chat completion run failed", err, {
      conversationId,
      chosenModelId,
    });
    // Reported in-band: the response is a 200 stream by the time this can fail,
    // so an SSE "error" event is the only channel left to the client.
    events.push("error", { message: "Model response failed" });
  } finally {
    events.end();
  }
}

/**
 * POST /conversations/:conversationId/messages — persist the user turn, then
 * stream the model's reply over SSE and persist it once complete.
 *
 * The run is detached from the response: a client that disconnects the moment
 * it posts (or never reads the body at all) still comes back to a conversation
 * holding both its message and the full reply. Streaming is only for watching
 * the answer arrive; `GET .../messages` is the source of truth.
 *
 * Events: `user_message` (the saved user row), `delta` ({ delta }) per model
 * chunk, `done` (the saved assistant row), `error` ({ message }). The client
 * consumes this with fetch + response.body.getReader() (EventSource can't POST).
 */
export async function handleCreateMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const content: string = c.get(CTX_KEYS.messageContent);
  const chosenModelId: string = c.get(CTX_KEYS.chosenModelId);
  const uploadIds: string[] = c.get(CTX_KEYS.attachmentUploadIds);
  const audioUploadId: string | undefined = c.get(CTX_KEYS.audioUploadId);

  // Ownership check, attachment resolution and the transcript read are
  // independent; all are simply discarded on the 404 paths.
  const [owned, attachments, transcript] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    resolveUnattachedImages(userId, uploadIds),
    audioUploadId ? readTurnTranscript(userId, audioUploadId) : null,
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

  const turns = await assembleConversationContext(
    userId,
    conversationId,
    buildUserTurn(
      transcript ? withTranscript(content, transcript) : content,
      attachments.map((attachment) => attachment.url),
    ),
    // Charged up front so history is what falls off to make room for it,
    // rather than the two together silently blowing past the budget.
    (transcript?.length ?? 0) + content.length,
  );

  const events = new SSEEventQueue();
  void runChatTurn(
    {
      userId,
      conversationId,
      content,
      chosenModelId,
      turns,
      attachments,
      audioUploadId,
    },
    events,
  );

  return streamSSE(c, (stream) => events.pipeTo(stream, c.req.raw.signal));
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
  return c.json({ message: "Message deleted" }, 200);
}
