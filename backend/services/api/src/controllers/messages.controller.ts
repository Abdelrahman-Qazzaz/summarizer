import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq } from "drizzle-orm";
import { ChatMessages, Conversations, db } from "../../../../shared/db";
import { CTX_KEYS } from "../../../../shared/keys";
import { chatAI } from "../../../../shared/ai/ai_client";
import type { ChatTurn } from "../../../../shared/ai/ai_client";
import { SSEEventQueue } from "../utils/sse";
import { logger } from "../../../../shared/logger";

const log = logger.child({ controller: "messages" });

/**
 * Bounds on what one turn can cost. The message cap alone isn't one: 50 turns
 * of the 50k chars the schema allows is a ~2.5M-char prompt, so the character
 * budget is what actually holds the line. Older turns simply fall off.
 */
const MAX_CONTEXT_MESSAGES = 50;
export const MAX_CONTEXT_CHARS = 100_000;
export const MAX_RESPONSE_TOKENS = 4_000;

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
 *
 * The new turn is always included, however long it is; history is admitted
 * newest-first until MAX_CONTEXT_CHARS is spent and truncated at the first turn
 * that doesn't fit — dropping that one but keeping older ones would splice the
 * conversation into something the model reads as a non-sequitur.
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

  const turns: ChatTurn[] = [{ role: "user", content }];
  let budget = MAX_CONTEXT_CHARS;

  for (const message of history) {
    budget -= message.content.length;
    if (budget < 0) break;
    turns.unshift({ role: message.role, content: message.content });
  }

  return turns;
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
  },
  events: SSEEventQueue,
) {
  const { userId, conversationId, content, chosenModelId, turns } = args;
  try {
    // The user turn must be durable (and its id known for the event) before the
    // model call; touching the conversation surfaces it in the list's ordering.
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
    events.push("user_message", toMessageJson(userMessage));

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

  // Ownership check and context building are independent reads; the turns are
  // simply discarded on the 404 path.
  const [owned, turns] = await Promise.all([
    findOwnedConversation(userId, conversationId),
    buildContextTurns(conversationId, content),
  ]);
  if (!owned) return c.json({ message: "Conversation not found" }, 404);

  const events = new SSEEventQueue();
  void runChatTurn(
    { userId, conversationId, content, chosenModelId, turns },
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
