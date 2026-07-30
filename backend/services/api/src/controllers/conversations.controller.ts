import type { Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { Conversations, db } from "../../../../shared/db";
import { CTX_KEYS } from "../../../../shared/keys";
import { deleteFilesFromBucket } from "../../../../shared/bucket";
import { findConversationImageUploadIds } from "../utils/imageUploads";

const conversationColumns = {
  id: Conversations.id,
  title: Conversations.title,
  createdAt: Conversations.createdAt,
  updatedAt: Conversations.updatedAt,
};

type ConversationRow = Pick<
  typeof Conversations.$inferSelect,
  keyof typeof conversationColumns
>;

function toConversationJson(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /conversations — the user's conversations, most recently active first.
 * Ordered by updatedAt, which posting a message and renaming both touch, so a
 * revived old conversation surfaces back to the top of the list.
 */
export async function handleListConversations(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const rows = await db
    .select(conversationColumns)
    .from(Conversations)
    .where(eq(Conversations.userId, userId))
    .orderBy(desc(Conversations.updatedAt), desc(Conversations.id));

  return c.json({ conversations: rows.map(toConversationJson) });
}

/** Ownership gate shared by every message route: 404 unless the user owns it. */
export async function findOwnedConversation(
  userId: string,
  conversationId: string,
) {
  const [row] = await db
    .select(conversationColumns)
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

/** GET /conversations/:conversationId */
export async function handleGetConversation(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  const row = await findOwnedConversation(userId, conversationId);

  if (!row) return c.json({ message: "Conversation not found" }, 404);
  return c.json(toConversationJson(row));
}

/** POST /conversations — title optional; the DB default applies when omitted. */
export async function handleCreateConversation(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const title: string | undefined = c.get(CTX_KEYS.conversationTitle);

  const [row] = await db
    .insert(Conversations)
    .values({ userId, ...(title !== undefined ? { title } : {}) })
    .returning(conversationColumns);

  return c.json(toConversationJson(row), 201);
}

/** PATCH /conversations/:conversationId — rename. */
export async function handlePatchConversation(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const title: string = c.get(CTX_KEYS.conversationTitle);

  const [row] = await db
    .update(Conversations)
    .set({ title, updatedAt: new Date() })
    .where(
      and(
        eq(Conversations.id, conversationId),
        eq(Conversations.userId, userId),
      ),
    )
    .returning(conversationColumns);

  if (!row) return c.json({ message: "Conversation not found" }, 404);
  return c.json(toConversationJson(row));
}

/** DELETE /conversations/:conversationId */
export async function handleDeleteConversation(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  const [row] = await db
    .delete(Conversations)
    .where(
      and(
        eq(Conversations.id, conversationId),
        eq(Conversations.userId, userId),
      ),
    )
    .returning({ id: Conversations.id });

  if (!row) return c.json({ message: "Conversation not found" }, 404);
  return c.json({ message: "Conversation deleted" }, 200);
}
