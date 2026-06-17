import type { Context } from "hono";
import { ai_client } from "../../../../shared/ai/ai_client";

export async function handleGetModels(c: Context) {
  const models = (await ai_client.models.list()).data;
  const modelData = Object.fromEntries(
    models.map((model) => [
      model.name,
      {
        description: model.description,
        knowledgeCutoff: model.knowledgeCutoff,
        topProvider: model.topProvider,
        pricing: model.pricing,
        supportedParameters: model.supportedParameters,
      },
    ]),
  );
  return c.json({ modelData });
}
