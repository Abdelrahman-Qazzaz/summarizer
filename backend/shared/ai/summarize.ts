import OpenAI from "openai";
import { getBaseEnv } from "../env";

const client = new OpenAI({
  apiKey: getBaseEnv().OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export async function summarize(text: string) {
  const res = await client.responses.create({
    model: "openai/gpt-4o-mini", // or any model on OpenRouter
    input: `Summarize the following text:\n\n${text}`,
  });

  return res.output_text;
}
