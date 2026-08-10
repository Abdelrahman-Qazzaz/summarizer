// TODO: cache per (kind, modelId) — kind is transcribe/text/etc. Even cached,
// the full model catalog is too large to justify validating against on every req.

import { getBaseEnv } from "../env";
import { OpenRouter } from "@openrouter/sdk";

import { getCache, setCache } from "../cache/cache";
import type {
  ChatContentItems,
  InputModality,
  OutputModality,
  Parameter,
  PublicPricing,
  TopProviderInfo,
} from "@openrouter/sdk/models";

const ai_client = new OpenRouter({
  apiKey: getBaseEnv().OPENROUTER_API_KEY,
});

/** Startup health check: fails if OpenRouter is unreachable or rejects the API key. */
export async function pingChatAI(): Promise<void> {
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
    /**
     * Groups a conversation's turns so OpenRouter routes them all to the same
     * provider (sticky), keeping that provider's prompt cache warm across the
     * turn's stable history prefix — the biggest lever on time-to-first-token.
     */
    sessionId?: string;
  } = {},
): Promise<string> {
  const maxCompletionTokens = opts.maxOutputTokens;
  // `sort: "latency"` routes to the lowest time-to-first-token endpoint (no load
  // balancing); paired with the sticky sessionId, turns stay on one fast, warm
  // provider.
  const routing = {
    provider: { sort: "latency" },
    sessionId: opts.sessionId,
  } as const;

  // Non-streaming
  if (!opts.onDelta) {
    const completion = await ai_client.chat.send({
      chatRequest: {
        model,
        messages,
        maxCompletionTokens,
        ...routing,
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
      ...routing,
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

type ChatModelData = {
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

// Every send validates the chosen model against this catalog, so the cache
// keeps that check off the network. The in-memory tier of getCache also spares
// each process the Redis round-trip once warm.
export async function getChatModelData(): Promise<ChatModelData> {
  const hit = await getCache<ChatModelData>("openRouterModels");
  if (hit != null) return hit;

  // Only text-output models are ever chosen here (summary/chat); transcription
  // is served by Deepgram. "text" is the SDK default — passed explicitly for
  // clarity — and keeps the fetched + cached catalog small.
  const models = (await ai_client.models.list({ outputModalities: "text" }))
    .data;
  const modelData: ChatModelData = Object.fromEntries(
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

  await setCache("openRouterModels", modelData);
  return modelData;
}

/**
 * Validates that a model exists and, when `requiredModality` is given, that the
 * model can actually produce that output (e.g. a summary model must output
 * "text"; a transcription model must output "transcription"). Without this, a
 * transcription-only model passes as a summary model and only fails deep in the
 * worker when the provider rejects the chat-completion request.
 */
async function findChatModel(modelId: string) {
  const modelData = await getChatModelData();
  return modelData[modelId];
}

export async function validateChatModelOutput(
  modelId: string,
  requiredModality: OutputModality,
): Promise<boolean> {
  const model = await findChatModel(modelId);
  return Boolean(model?.outputModalities.includes(requiredModality));
}

/**
 * The input counterpart: whether the model can be *given* this modality, e.g. a
 * chat turn carrying image attachments needs one that accepts "image". Checked
 * up front so a text-only model is a 400 on the request rather than a provider
 * rejection mid-stream, where the only channel left is an SSE error event.
 */
export async function validateChatModelInput(
  modelId: string,
  requiredModality: InputModality,
): Promise<boolean> {
  const model = await findChatModel(modelId);
  return Boolean(model?.inputModalities.includes(requiredModality));
}

export const DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini";
