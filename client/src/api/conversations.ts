import { conversationEndpoint, conversationsEndpoint } from "../config";
import { apiFetch, apiJson, jsonRequest } from "./http";

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchConversations(): Promise<Conversation[]> {
  const data = await apiJson<{ conversations: Conversation[] }>(
    conversationsEndpoint(),
  );
  if (!Array.isArray(data?.conversations)) {
    throw new Error("Invalid conversations response");
  }
  return data.conversations;
}

export async function createConversation(title: string): Promise<Conversation> {
  return apiJson<Conversation>(
    conversationsEndpoint(),
    jsonRequest("POST", { conversationTitle: title }),
  );
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<Conversation> {
  return apiJson<Conversation>(
    conversationEndpoint(conversationId),
    jsonRequest("PATCH", { conversationTitle: title }),
  );
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await apiFetch(conversationEndpoint(conversationId), { method: "DELETE" });
}
