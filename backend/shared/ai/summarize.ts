import { promptAI } from "./ai_client";

export async function summarize(text: string) {
  const res = await promptAI(
    "openai/gpt-4o-mini", // or any model on OpenRouter
    `Summarize the following text:\n\n${text}`,
  );
  return res;
}
