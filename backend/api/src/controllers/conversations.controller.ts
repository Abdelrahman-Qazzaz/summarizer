import type { Context } from "hono";
import { CTX_KEYS } from "../../../shared/keys";
import { deleteFilesFromBucket } from "../../../shared/bucket";
import { findConversationImageUploadIds } from "../data/images.data";
import {
  createConversation,
  deleteOwnedConversation,
  findOwnedConversation,
  findUserConversations,
  renameConversation,
  type ConversationRow,
} from "../data/conversations.data";

function toConversationJson(row: ConversationRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** GET /conversations — the user's conversations, most recently active first. */
export async function handleListConversations(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const rows = await findUserConversations(userId);

  return c.json({ conversations: rows.map(toConversationJson) });
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

  const row = await createConversation(userId, title);

  return c.json(toConversationJson(row), 201);
}

/** PATCH /conversations/:conversationId — rename. */
export async function handlePatchConversation(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);
  const title: string = c.get(CTX_KEYS.conversationTitle);

  const row = await renameConversation(userId, conversationId, title);

  if (!row) return c.json({ message: "Conversation not found" }, 404);
  return c.json(toConversationJson(row));
}

/** DELETE /conversations/:conversationId */
export async function handleDeleteConversation(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const conversationId = c.get(CTX_KEYS.conversationId);

  // Read before the delete: the image rows naming these objects cascade away
  // with the conversation's messages (see handleDeleteMessage).
  const imageUploadIds = await findConversationImageUploadIds(
    userId,
    conversationId,
  );

  const row = await deleteOwnedConversation(userId, conversationId);

  if (!row) {
    const ownedConversation = await findOwnedConversation(userId, conversationId);
    if (!ownedConversation)
      return c.json({ message: "Conversation not found" }, 404);
    return c.json({ message: "A response is already in progress" }, 409);
  }

  await deleteFilesFromBucket(userId, imageUploadIds);
  return c.json({ message: "Conversation deleted" }, 200);
}
