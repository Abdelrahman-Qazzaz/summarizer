import { promptAI } from "./ai_client";

export async function summarize(model: string, text: string) {
  const res = await promptAI(model, `Summarize the following text:\n\n${text}`);
  return res;
}
