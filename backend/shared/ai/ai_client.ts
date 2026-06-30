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
import { logger } from "../logger";

export const ai_client = new OpenRouter({
  apiKey: getBaseEnv().OPENROUTER_API_KEY,
});

/** Startup health check: fails if OpenRouter is unreachable or rejects the API key. */
export async function pingAi(): Promise<void> {
  await ai_client.models.list();
}

export async function promptAI(
  model: string = DEFAULT_MODELS.PROMPT,
  prompt: string,
  opts: { onDelta?: (delta: string) => void } = {},
) {
  const messages = [{ role: "user" as const, content: prompt }];

  // Non-streaming path (unchanged): return the full content at once.
  if (!opts.onDelta) {
    const completion = await ai_client.chat.send({
      chatRequest: { model, messages },
    });

    return completion.choices[0]?.message?.content ?? "";
  }

  // Streaming path: emit each delta as it arrives, but still accumulate and
  // return the full string so callers see the same contract.
  const stream = await ai_client.chat.send({
    chatRequest: { model, messages, stream: true },
  });

  let full = "";
  for await (const chunk of stream) {
    if (chunk.error) throw new Error(chunk.error.message);
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      opts.onDelta(delta);
    }
  }

  return full;
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

  const models = (await ai_client.models.list({ outputModalities: "all" }))
    .data;
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

/**
 * Validates that a model exists and, when `requiredModality` is given, that the
 * model can actually produce that output (e.g. a summary model must output
 * "text"; a transcription model must output "transcription"). Without this, a
 * transcription-only model passes as a summary model and only fails deep in the
 * worker when the provider rejects the chat-completion request.
 */
export async function validateModel(
  modelId: string,
  requiredModality?: OutputModality,
): Promise<boolean> {
  const hit = (await checkCache(
    CACHE_KEYS.openRouterModels,
  )) as ModelData | null;

  const modelData: ModelData = hit ?? (await getModelData());
  const byId = modelData[modelId];
  if (!byId) return false;
  if (requiredModality && !byId.outputModalities.includes(requiredModality))
    return false;
  return true;
}

export const DEFAULT_MODELS = {
  TRANSCRIBE: "openai/gpt-4o-mini-transcribe",
  PROMPT: "openai/gpt-4o-mini",
};
