import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq } from "drizzle-orm";
import { ChatMessages, Conversations, db } from "../../../../shared/db";
import { CTX_KEYS } from "../../../../shared/keys";
import { chatAI } from "../../../../shared/ai/ai_client";
import type { ChatTurn } from "../../../../shared/ai/ai_client";
import { SSEEventQueue } from "../utils/sse";
import {
  InvalidAttachmentsError,
  attachmentsWithUrlsByMessageId,
  imageContentPart,
  imageUrlsFor,
  insertAttachmentRows,
  resolveImageAttachments,
  toAttachmentJson,
} from "../utils/chatAttachments";
import type {
  ImageUploadRow,
  MessageAttachmentInput,
  ResolvedAttachment,
} from "../utils/chatAttachments";
import { logger } from "../../../../shared/logger";
import { tryCatch } from "../../../../shared/try-catch";
import { findOwnedConversation } from "./conversations.controller";

const log = logger.child({ controller: "messages" });

/** Bounds on one turn. The char budget is the real cap: 50 × 50k is ~2.5M chars. */
const MAX_CONTEXT_MESSAGES = 50;
export const MAX_CONTEXT_CHARS = 100_000;
export const MAX_RESPONSE_TOKENS = 4_000;

function toMessageJson(
  row: typeof ChatMessages.$inferSelect,
  attachments: ResolvedAttachment[] = [],
) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    chosenModelId: row.chosenModelId,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    attachments: attachments.map((a) => toAttachmentJson(a.row, a.url)),
  };
}

/**
 *   history  = SELECT newest MAX_CONTEXT_MESSAGES-1 turns
 *   admitted = take from newest while MAX_CONTEXT_CHARS lasts, stop at 1st overflow
 *   attach     images of admitted turns as content parts
 *   → admitted reversed to oldest-first, the order the model expects
 *
 * Stops rather than skips: a hole mid-conversation reads as a non-sequitur.
 * Caller appends the new turn — running before its INSERT is what keeps it
 * from appearing twice.
 */
async function buildContextTurns(conversationId: string): Promise<ChatTurn[]> {
  const history = await db
    .select()
    .from(ChatMessages)
    .where(eq(ChatMessages.conversationId, conversationId))
    .orderBy(desc(ChatMessages.createdAt), desc(ChatMessages.id))
    .limit(MAX_CONTEXT_MESSAGES - 1);

  const admitted: typeof history = [];
  let budget = MAX_CONTEXT_CHARS;
  for (const message of history) {
    budget -= message.content.length;
    if (budget < 0) break;
    admitted.push(message);
  }

  const byMessage = await attachmentsWithUrlsByMessageId(
    admitted.map((m) => m.id),
  );

  return admitted.reverse().map((m): ChatTurn => {
    const imageParts = (byMessage.get(m.id) ?? [])
      .filter((a) => a.row.kind === "image" && a.url)
      .map((a) => imageContentPart(a.url as string));
    if (!imageParts.length) return { role: m.role, content: m.content };

    return {
      role: m.role,
      content: [{ type: "text", text: m.content }, ...imageParts],
    };
  });
}

/** GET /conversations/:conversationId/messages — full history, oldest first. */
export async function handleListMessages(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  // Independent reads; rows are discarded on the 404 path.
  const [owned, rows] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    db
      .select()
      .from(ChatMessages)
      .where(eq(ChatMessages.conversationId, conversationId))
      .orderBy(asc(ChatMessages.createdAt), asc(ChatMessages.id)),
  ]);

  if (!owned) return c.json({ message: "Conversation not found" }, 404);

  const byMessage = await attachmentsWithUrlsByMessageId(rows.map((m) => m.id));

  return c.json({
    messages: rows.map((row) => toMessageJson(row, byMessage.get(row.id))),
  });
}

/**
 *   INSERT user turn  ‖  touch conversation.updatedAt
 *   INSERT attachments                    (needs the user turn's id)
 *   push  user_message
 *   chatAI → push delta per chunk
 *   INSERT assistant turn → push done
 *   throw → push error                    always → end()
 *
 * Never rejects. Takes the queue, not the stream, so the run outlives the
 * connection. Assistant row lands only after the model finishes, so a crash
 * leaves the user turn saved and no reply — never the reverse.
 */
async function runChatTurn(
  args: {
    userId: string;
    conversationId: string;
    content: string;
    chosenModelId: string;
    turns: ChatTurn[];
    imageRows: readonly ImageUploadRow[];
    imageUrls: Map<string, string>;
  },
  events: SSEEventQueue,
) {
  const {
    userId,
    conversationId,
    content,
    chosenModelId,
    turns,
    imageRows,
    imageUrls,
  } = args;
  try {
    const [[userMessage]] = await Promise.all([
      db
        .insert(ChatMessages)
        .values({ role: "user", content, conversationId, userId })
        .returning(),
      db
        .update(Conversations)
        .set({ updatedAt: new Date() })
        .where(eq(Conversations.id, conversationId)),
    ]);

    const attachmentRows = await insertAttachmentRows(
      userMessage.id,
      imageRows,
    );
    events.push(
      "user_message",
      toMessageJson(
        userMessage,
        attachmentRows.map((row) => ({
          row,
          url: imageUrls.get(row.uploadId) ?? null,
        })),
      ),
    );

    const full = await chatAI(chosenModelId, turns, {
      onDelta: (delta) => events.push("delta", { delta }),
      maxOutputTokens: MAX_RESPONSE_TOKENS,
    });

    const [assistantMessage] = await db
      .insert(ChatMessages)
      .values({
        role: "assistant",
        content: full,
        chosenModelId,
        conversationId,
        userId,
      })
      .returning();

    events.push("done", toMessageJson(assistantMessage));
  } catch (err) {
    log.error("Chat completion run failed", err, {
      conversationId,
      chosenModelId,
    });
    // In-band: the 200 headers are long gone, so SSE is the only channel left.
    events.push("error", { message: "Model response failed" });
  } finally {
    events.end();
  }
}

/**
 * POST /conversations/:conversationId/messages
 *
 *   parallel: conversation owned? | attachments owned? | build history
 *             ↳ 404               ↳ 400
 *   turns = history + new turn (text, plus image parts if any)
 *   spawn runChatTurn(turns) ──push──► queue
 *   return SSE stream        ◄──pipe── queue, until done or client disconnect
 *
 * Events: user_message → delta* → done, or error. Consumed with fetch +
 * response.body.getReader(), since EventSource can't POST.
 *
 * The run is detached from the response, so a client that disconnects still
 * comes back to both rows: streaming only watches, GET is the source of truth.
 * A 200 therefore means the run started, not that anything is persisted yet —
 * only 400/404 are decided before the first write.
 */
export async function handleCreateMessage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const content: string = c.get(CTX_KEYS.messageContent);
  const chosenModelId: string = c.get(CTX_KEYS.chosenModelId);
  const attachments: MessageAttachmentInput[] =
    c.get(CTX_KEYS.messageAttachments) ?? [];

  // Independent reads; turns and rows are discarded on the 404 path.
  const { data, error } = await tryCatch(
    Promise.all([
      findOwnedConversation(userId, conversationId),
      resolveImageAttachments(userId, attachments),
      buildContextTurns(conversationId),
    ]),
  );
  if (error instanceof InvalidAttachmentsError) {
    return c.json({ message: error.message }, 400);
  }
  if (error) throw error;

  const [owned, imageRows, historyTurns] = data;
  if (!owned) return c.json({ message: "Conversation not found" }, 404);

  // Cached from upload time in the normal case, so this signs nothing.
  const imageUrls = await imageUrlsFor(imageRows);
  const imageParts = imageRows
    .map((row) => imageUrls.get(row.uploadId))
    .filter((url): url is string => !!url)
    .map(imageContentPart);
  const newTurnContent: ChatTurn["content"] = imageParts.length
    ? [{ type: "text", text: content }, ...imageParts]
    : content;
  const turns: ChatTurn[] = [
    ...historyTurns,
    { role: "user", content: newTurnContent },
  ];

  const events = new SSEEventQueue();
  void runChatTurn(
    {
      userId,
      conversationId,
      content,
      chosenModelId,
      turns,
      imageRows,
      imageUrls,
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

  if (!row) return c.json({ message: "Message not found" }, 404);
  return c.json({ message: "Message deleted" }, 200);
}
