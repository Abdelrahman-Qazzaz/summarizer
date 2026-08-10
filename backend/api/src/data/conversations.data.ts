import { and, desc, eq, type SQL } from "drizzle-orm";
import { Conversations, db } from "../../../shared/db";

const conversationColumns = {
  id: Conversations.id,
  title: Conversations.title,
  createdAt: Conversations.createdAt,
  updatedAt: Conversations.updatedAt,
  contextHash: Conversations.contextHash,
};

export type ConversationRow = Pick<
  typeof Conversations.$inferSelect,
  keyof typeof conversationColumns
>;

/** Every write and single-row read is gated on ownership, never id alone. */
function ownedBy(userId: string, conversationId: string): SQL | undefined {
  return and(
    eq(Conversations.id, conversationId),
    eq(Conversations.userId, userId),
  );
}

/**
 * Most recently active first. `updatedAt` is touched by both posting a message
 * and renaming, so a revived old conversation surfaces back to the top.
 */
export async function findUserConversations(userId: string) {
  return db
    .select(conversationColumns)
    .from(Conversations)
    .where(eq(Conversations.userId, userId))
    .orderBy(desc(Conversations.updatedAt), desc(Conversations.id));
}

/** Ownership gate shared by every message route: null unless the user owns it. */
export async function findOwnedConversation(
  userId: string,
  conversationId: string,
) {
  const [row] = await db
    .select(conversationColumns)
    .from(Conversations)
    .where(ownedBy(userId, conversationId))
    .limit(1);

  return row ?? null;
}

/** Omitting `title` leaves the column to its DB default. */
export async function createConversation(userId: string, title?: string) {
  const [row] = await db
    .insert(Conversations)
    .values({ userId, ...(title !== undefined ? { title } : {}) })
    .returning(conversationColumns);

  return row;
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string,
) {
  const [row] = await db
    .update(Conversations)
    .set({ title, updatedAt: new Date() })
    .where(ownedBy(userId, conversationId))
    .returning(conversationColumns);

  return row ?? null;
}

/** Null when the user doesn't own it, which the caller reports as a 404. */
export async function deleteOwnedConversation(
  userId: string,
  conversationId: string,
) {
  const [row] = await db
    .delete(Conversations)
    .where(ownedBy(userId, conversationId))
    .returning({ id: Conversations.id });

  return row ?? null;
}

/**
 * Records the turn just completed: bumps the conversation to the top of the list
 * and stores the fingerprint of the context its reply was generated against,
 * checked against the client's next turn.
 */
export async function recordConversationContext(
  userId: string,
  conversationId: string,
  contextHash: string,
) {
  await db
    .update(Conversations)
    .set({ updatedAt: new Date(), contextHash })
    .where(ownedBy(userId, conversationId));
}
