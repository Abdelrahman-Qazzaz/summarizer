// TODO: add cache where the key is (kind,modelid), where kind is transcribe/text/etc. Because even when cached, the result of openRouterModelsCacheKey is too large to justify being ran every req

import { getBaseEnv } from "../env";
import { OpenRouter } from "@openrouter/sdk";

import { CACHE_KEYS } from "../keys";
import { checkCache, setCache } from "../redis";
import type {
  ChatContentItems,
  InputModality,
  OutputModality,
  Parameter,
  PublicPricing,
  TopProviderInfo,
} from "@openrouter/sdk/models";

export const ai_client = new OpenRouter({
  apiKey: getBaseEnv().OPENROUTER_API_KEY,
});

/** Startup health check: fails if OpenRouter is unreachable or rejects the API key. */
export async function pingAi(): Promise<void> {
  await ai_client.models.list();
}

export type ChatTurn = {
  role: "user" | "assistant";
  content: string | ChatContentItems[];
};

/**
 * A user turn, as content parts when it carries images and as a plain string
 * otherwise — the array form costs nothing to send but is noise in every log
 * and test for the text-only turns that are the overwhelming majority.
 */
export function buildUserTurn(
  content: string,
  imageUrls: readonly string[] = [],
): ChatTurn {
  if (imageUrls.length === 0) return { role: "user", content };

  return {
    role: "user",
    content: [
      { type: "text", text: content },
      ...imageUrls.map((url) => ({
        type: "image_url" as const,
        imageUrl: { url },
      })),
    ],
  };
}

export async function chatAI(
  model: string,
  messages: ChatTurn[],
  opts: {
    onDelta?: (delta: string) => void | Promise<void>;
    /** Ceiling on the completion, so one call can't run up an unbounded bill. */
    maxOutputTokens?: number;
  } = {},
): Promise<string> {
  const maxCompletionTokens = opts.maxOutputTokens;

  // Non-streaming
  if (!opts.onDelta) {
    const completion = await ai_client.chat.send({
      chatRequest: {
        model,
        messages,
        maxCompletionTokens,
      },
    });

    return completion.choices[0]?.message?.content ?? "";
  }

  // Streaming
  const stream = await ai_client.chat.send({
    chatRequest: {
      model,
      messages,
      maxCompletionTokens,
      stream: true,
    },
  });

  let full = "";
  for await (const chunk of stream) {
    if (chunk.error) throw new Error(chunk.error.message);
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      await opts.onDelta(delta);
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
    inputModalities: InputModality[];
  };
};

/**
 * The catalog changes rarely, but it does change — a day-long entry keeps a
 * newly listed model from waiting on a hand-bumped CACHE_KEYS version.
 */
const MODEL_CATALOG_TTL_SECONDS = 24 * 60 * 60;

export async function getModelData() {
  const openRouterModelsCacheKey = CACHE_KEYS.openRouterModels;
  const hit = (await checkCache(openRouterModelsCacheKey)) as ModelData | null;

  if (hit != null) return hit;

  const models = (await ai_client.models.list({ outputModalities: "all" })) //TODO: make this smaller
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
        inputModalities: model.architecture.inputModalities,
      },
    ]),
  );

  await setCache(
    openRouterModelsCacheKey,
    modelData,
    MODEL_CATALOG_TTL_SECONDS,
  );
  return modelData;
}

/**
 * Validates that a model exists and, when `requiredModality` is given, that the
 * model can actually produce that output (e.g. a summary model must output
 * "text"; a transcription model must output "transcription"). Without this, a
 * transcription-only model passes as a summary model and only fails deep in the
 * worker when the provider rejects the chat-completion request.
 */
async function findModel(modelId: string) {
  const hit = (await checkCache(
    CACHE_KEYS.openRouterModels,
  )) as ModelData | null;

  const modelData: ModelData = hit ?? (await getModelData());
  return modelData[modelId];
}

export async function validateModelOutput(
  modelId: string,
  requiredModality: OutputModality,
): Promise<boolean> {
  const model = await findModel(modelId);
  return Boolean(model?.outputModalities.includes(requiredModality));
}

/**
 * The input counterpart: whether the model can be *given* this modality, e.g. a
 * chat turn carrying image attachments needs one that accepts "image". Checked
 * up front so a text-only model is a 400 on the request rather than a provider
 * rejection mid-stream, where the only channel left is an SSE error event.
 */
export async function validateModelInput(
  modelId: string,
  requiredModality: InputModality,
): Promise<boolean> {
  const model = await findModel(modelId);
  return Boolean(model?.inputModalities.includes(requiredModality));
}

export const DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini";
