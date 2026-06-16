import { getBaseEnv } from "../env";
import { OpenRouter } from "@openrouter/sdk";

export const ai_client = new OpenRouter({
  apiKey: getBaseEnv().OPENROUTER_API_KEY,
});

export async function promptAI(
  model: string = "openai/gpt-4o-mini",
  prompt: string,
) {
  const completion = await ai_client.chat.send({
    chatRequest: {
      model,
      messages: [{ role: "user", content: prompt }],
    },
  });

  return completion.choices[0]?.message?.content ?? "";
}
