import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq } from "drizzle-orm";
import { ChatMessages, Conversations, db } from "../../../../shared/db";
import { CTX_KEYS } from "../../../../shared/keys";
import { chatAI } from "../../../../shared/ai/ai_client";
import type { ChatTurn } from "../../../../shared/ai/ai_client";
import { sendEvent } from "../utils/sse";
import { logger } from "../../../../shared/logger";

const log = logger.child({ controller: "messages" });

/**
 * Cap on how many prior messages are replayed to the model as context. Keeps
 * the prompt bounded on long conversations; older turns simply fall off.
 */
const MAX_CONTEXT_MESSAGES = 50;

function toMessageJson(row: typeof ChatMessages.$inferSelect) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    chosenModelId: row.chosenModelId,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
  };
}

/**
 * The model context for a new user turn: the conversation's most recent
 * history (fetched newest-first so LIMIT keeps the latest turns, then reversed
 * into the oldest-first order the model expects) plus the new turn itself.
 * Must run before the new turn is inserted, so it can't appear twice.
 */
async function buildContextTurns(
  conversationId: string,
  content: string,
): Promise<ChatTurn[]> {
  const history = await db
    .select()
    .from(ChatMessages)
    .where(eq(ChatMessages.conversationId, conversationId))
    .orderBy(desc(ChatMessages.createdAt), desc(ChatMessages.id))
    .limit(MAX_CONTEXT_MESSAGES - 1);

  return [
    ...history
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }) as ChatTurn),
    { role: "user", content },
  ];
}

/** Ownership gate shared by every message route: 404 unless the user owns it. */
async function findOwnedConversation(userId: string, conversationId: string) {
  const [row] = await db
    .select({ id: Conversations.id })
    .from(Conversations)
    .where(
      and(
        eq(Conversations.id, conversationId),
        eq(Conversations.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** GET /conversations/:conversationId/messages — full history, oldest first. */
export async function handleListMessages(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  // Ownership check and the rows themselves are independent reads; the rows
  // are simply discarded on the 404 path.
  const [owned, rows] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    db
      .select()
      .from(ChatMessages)
      .where(eq(ChatMessages.conversationId, conversationId))
      .orderBy(asc(ChatMessages.createdAt), asc(ChatMessages.id)),
  ]);

  if (!owned) return c.json({ message: "Conversation not found" }, 404);

  return c.json({ messages: rows.map(toMessageJson) });
}

/**
 * POST /conversations/:conversationId/messages — persist the user turn, then
 * stream the model's reply over SSE and persist it once complete.
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

  // Ownership check and context building are independent reads; the turns are
  // simply discarded on the 404 path.
  const [owned, turns] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    buildContextTurns(conversationId, content),
  ]);
  if (!owned) return c.json({ message: "Conversation not found" }, 404);

  // Query builders only; drizzle runs them lazily when awaited, which happens
  // inside the stream — so the SSE response opens without waiting on writes.
  const persistUserTurn = db
    .insert(ChatMessages)
    .values({ role: "user", content, conversationId, userId })
    .returning();
  // Surface the new activity in the conversation list's ordering metadata.
  const touchConversation = db
    .update(Conversations)
    .set({ updatedAt: new Date() })
    .where(eq(Conversations.id, conversationId));

  return streamSSE(c, async (stream) => {
    // Errors are reported in-band: headers (200) are already sent once the
    // first byte streams, so an SSE "error" event is the only channel left.
    try {
      // The user turn must be durable (and its id known for the event) before
      // the model call; the assistant row is only written after the model
      // finishes, right before `done` hands the persisted row to the client.
      const [[userMessage]] = await Promise.all([
        persistUserTurn,
        touchConversation,
      ]);
      await sendEvent(stream, "user_message", toMessageJson(userMessage));

      const full = await chatAI(chosenModelId, turns, {
        onDelta: (delta) => sendEvent(stream, "delta", { delta }),
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

      await sendEvent(stream, "done", toMessageJson(assistantMessage));
    } catch (err) {
      log.error("Chat completion stream failed", err, {
        conversationId,
        chosenModelId,
      });
      await sendEvent(stream, "error", { message: "Model response failed" });
    }
  });
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
