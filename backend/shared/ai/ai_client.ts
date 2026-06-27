import { getBaseEnv } from "../env";
import { OpenRouter } from "@openrouter/sdk";

import { CACHE_KEYS } from "../keys";
import { checkCache, setCache } from "../redis";
import type {
  OutputModality,
  Parameter,
  PublicPricing,
  TopProviderInfo,
} from "@openrouter/sdk/models";

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

type ModelData = {
  [k: string]: {
    id: string;
    name: string;
    description: string | undefined;
    knowledgeCutoff: string | null | undefined;
    topProvider: TopProviderInfo;
    pricing: PublicPricing;
    supportedParameters: Parameter[];
    outputModalities: OutputModality[];
  };
};

export async function getModelData() {
  const openRouterModelsCacheKey = CACHE_KEYS.openRouterModels;
  const hit = (await checkCache(openRouterModelsCacheKey)) as ModelData | null;

  if (hit != null) return hit;

  const models = (await ai_client.models.list()).data;
  const modelData: ModelData = Object.fromEntries(
    models.map((model) => [
      model.id,
      {
        id: model.id,
        name: model.name,
        description: model.description,
        knowledgeCutoff: model.knowledgeCutoff,
        topProvider: model.topProvider,
        pricing: model.pricing,
        supportedParameters: model.supportedParameters,
        outputModalities: model.architecture.outputModalities,
      },
    ]),
  );

  await setCache(openRouterModelsCacheKey, modelData);
  return modelData;
}

export async function validateModel(modelId: string): Promise<boolean> {
  const hit = (await checkCache(
    CACHE_KEYS.openRouterModels,
  )) as ModelData | null;

  const modelData: ModelData = hit ?? (await getModelData());
  const byId = modelData[modelId];
  if (byId) return true;
  return false;
}
