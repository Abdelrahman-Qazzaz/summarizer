import type { Context } from "hono";
import { getModelData } from "../../../shared/ai/ai_chat_client";

export async function handleGetModels(c: Context) {
  const modelData = await getModelData();
  return c.json({ modelData });
}
