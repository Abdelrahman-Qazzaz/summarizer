import { openai } from "./ai_client";

export async function summarize(text: string) {
  const res = await openai.responses.create({
    model: "openai/gpt-4o-mini", // or any model on OpenRouter
    input: `Summarize the following text:\n\n${text}`,
  });

  return res.output_text;
}
