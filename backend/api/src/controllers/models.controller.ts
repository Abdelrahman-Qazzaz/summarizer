import type { Context } from "hono";
import { getChatModelData } from "../../../shared/ai/ai_chat_client";

export async function handleGetModels(c: Context) {
  const modelData = await getChatModelData();
  return c.json({ modelData });
}
