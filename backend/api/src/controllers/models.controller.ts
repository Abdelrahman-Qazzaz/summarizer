import type { Context } from "hono";
import { getChatModelData } from "../../../shared/ai/ai_chat_client";
import { getTranscribeModelData } from "../../../shared/ai/ai_transcribe_client";

export async function handleGetModels(c: Context) {
  const modelData = await getChatModelData();
  return c.json({ modelData });
}

export async function handleGetTranscribeModels(c: Context) {
  const transcriptionModelData = await getTranscribeModelData();
  return c.json({ transcriptionModelData });
}
