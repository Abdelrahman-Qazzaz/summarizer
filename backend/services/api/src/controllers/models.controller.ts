import type { Context } from "hono";
import { ai_client, getModelData } from "../../../../shared/ai/ai_client";

export async function handleGetModels(c: Context) {
  const modelData = await getModelData();
  return c.json({ modelData });
}
