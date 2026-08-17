import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  Conversations,
  DEFAULT_CONVERSATION_TITLE,
  db,
  type Executor,
} from "../../../shared/db";

const conversationColumns = {
  id: Conversations.id,
  title: Conversations.title,
  createdAt: Conversations.createdAt,
  updatedAt: Conversations.updatedAt,
  lastMessageId: Conversations.lastMessageId,
  activeTurnClaimToken: Conversations.activeTurnClaimToken,
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

export async function claimConversationTurn(
  userId: string,
  conversationId: string,
  expectedLastMessageId: string | null,
) {
  const claimToken = randomUUID();
  const [row] = await db
    .update(Conversations)
    .set({ activeTurnClaimToken: claimToken })
    .where(
      and(
        ownedBy(userId, conversationId),
        isNull(Conversations.activeTurnClaimToken),
        expectedLastMessageId === null
          ? isNull(Conversations.lastMessageId)
          : eq(Conversations.lastMessageId, expectedLastMessageId),
      ),
    )
    .returning({ id: Conversations.id });

  return row ? claimToken : null;
}

export async function releaseConversationTurn(
  userId: string,
  conversationId: string,
  claimToken: string,
  executor: Executor = db,
) {
  await executor
    .update(Conversations)
    .set({ activeTurnClaimToken: null })
    .where(
      and(
        ownedBy(userId, conversationId),
        eq(Conversations.activeTurnClaimToken, claimToken),
      ),
    );
}

export async function completeConversationTurn(
  userId: string,
  conversationId: string,
  claimToken: string,
  lastMessageId: string,
  conversationTitle?: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .update(Conversations)
    .set({
      lastMessageId,
      activeTurnClaimToken: null,
      updatedAt: new Date(),
      ...(conversationTitle
        ? {
            title: sql<string>`case when ${Conversations.title} = ${DEFAULT_CONVERSATION_TITLE} then ${conversationTitle} else ${Conversations.title} end`,
          }
        : {}),
    })
    .where(
      and(
        ownedBy(userId, conversationId),
        eq(Conversations.activeTurnClaimToken, claimToken),
      ),
    )
    .returning({ id: Conversations.id });

  return Boolean(row);
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
    .where(
      and(
        ownedBy(userId, conversationId),
        isNull(Conversations.activeTurnClaimToken),
      ),
    )
    .returning({ id: Conversations.id });

  return row ?? null;
}
