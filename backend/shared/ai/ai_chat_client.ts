import { getBaseEnv } from "../env";
import { OpenRouter } from "@openrouter/sdk";

import { CACHE_KEYS, getCache, setCache } from "../cache/cache";
import type {
  ChatContentItems,
  ChatRequest,
  InputModality,
  OutputModality,
  Parameter,
  PublicPricing,
  TopProviderInfo,
} from "@openrouter/sdk/models";
import { withTimeout } from "../withTimeout";

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
        type: "image_url" as const, // find more rhobust way, or find a way to unify "image_url"
        imageUrl: { url },
      })),
    ],
  };
}

// Nothing else ends a stalled model call: OpenRouter's keep-alive comments keep
// the connection open, and the SDK drops them before they reach us. Until the
// call ends, the handler holds the conversation claim and attachment
// reservations. The total stays under CLAIM_LEASE_MS (10 minutes) so the turn
// can still be persisted afterwards.
const CHAT_TOTAL_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes
// Reasoning models can think for minutes before their first token.
const CHAT_FIRST_TOKEN_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const CHAT_BETWEEN_CHUNKS_TIMEOUT_MS = 30 * 1000; // 30 seconds
const TITLE_TIMEOUT_MS = 15 * 1000; // 15 seconds

async function nonStreamChatAI(
  chatRequest: ChatRequest,
  abortSignal: AbortSignal,
) {
  const completion = await ai_client.chat.send(
    { chatRequest },
    { signal: abortSignal },
  );

  if (!("choices" in completion))
    throw new Error("Expected a non-streaming chat response");

  const content = completion.choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

async function streamChatAI(
  chatRequest: ChatRequest,
  onDelta: (delta: string) => void | Promise<void>,
  {
    abortSignal,
    markProgress,
  }: { abortSignal: AbortSignal; markProgress: () => void },
) {
  const stream = await ai_client.chat.send(
    { chatRequest: { ...chatRequest, stream: true } },
    { signal: abortSignal },
  );

  if (!(Symbol.asyncIterator in stream))
    throw new Error("Expected a streaming chat response");

  let full = "";

  for await (const chunk of stream) {
    if (chunk.error) throw new Error(chunk.error.message);

    const delta = chunk.choices[0]?.delta?.content;

    // Only text counts: a stream can open with an empty chunk and then think
    // silently for longer than the between-chunk limit.
    if (delta) {
      markProgress();
      full += delta;
      await onDelta(delta);
    }
  }

  return full;
}

type ChatOptions = {
  onDelta?: ((delta: string) => void | Promise<void>) | undefined;
  /** Ceiling on the completion, so one call can't run up an unbounded bill. */
  maxOutputTokens?: number | undefined;
  /**
   * Groups a conversation's turns so OpenRouter routes them all to the same
   * provider (sticky), keeping that provider's prompt cache warm across the
   * turn's stable history prefix — the biggest lever on time-to-first-token.
   */
  sessionId?: string | undefined;
  /** Ceiling on the whole call. Defaults to CHAT_TOTAL_TIMEOUT_MS. */
  timeoutMs?: number | undefined;
};

export async function chatAI(
  model: string,
  messages: ChatTurn[],
  opts: ChatOptions = {},
): Promise<string> {
  const chatRequest: ChatRequest = {
    model,
    messages,
    maxCompletionTokens: opts.maxOutputTokens,
    // `sort: "latency"` routes to the lowest time-to-first-token endpoint (no
    // load balancing); paired with the sticky sessionId, turns stay on one fast,
    // warm provider.
    provider: { sort: "latency" },
    sessionId: opts.sessionId,
  };

  const timeoutOptions = {
    timeoutMs: opts.timeoutMs ?? CHAT_TOTAL_TIMEOUT_MS,
    firstProgressTimeoutMs: opts.onDelta
      ? CHAT_FIRST_TOKEN_TIMEOUT_MS
      : undefined,
    progressTimeoutMs: opts.onDelta
      ? CHAT_BETWEEN_CHUNKS_TIMEOUT_MS
      : undefined,
  };

  return withTimeout(timeoutOptions, (ctx) =>
    opts.onDelta
      ? streamChatAI(chatRequest, opts.onDelta, ctx)
      : nonStreamChatAI(chatRequest, ctx.abortSignal),
  );
}

type ChatModelData = {
  [k: string]: {
    id: string;
    name: string;
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
  const hit = await getCache<ChatModelData>(CACHE_KEYS.openRouterModels);
  if (hit != null) return hit;

  // Only text-output models are ever chosen here (summary/chat); transcription
  // is served by Deepgram. "text" is the SDK default — passed explicitly for
  // clarity — and keeps the fetched + cached catalog small.
  const models = (await ai_client.models.list({ outputModalities: "text" }))
    .result.data;
  const modelData: ChatModelData = Object.fromEntries(
    models.map((model) => [
      model.id,
      {
        id: model.id,
        name: model.name,
        knowledgeCutoff: model.knowledgeCutoff,
        topProvider: model.topProvider,
        pricing: model.pricing,
        supportedParameters: model.supportedParameters,
        outputModalities: model.architecture.outputModalities,
        inputModalities: model.architecture.inputModalities,
      },
    ]),
  );

  // setCache fills the in-process memo synchronously and only its Redis write
  // is async, and a failed write is logged rather than thrown. Awaiting it
  // wouldn't stall the event loop — other requests are served meanwhile — but it
  // would hold up whichever request took the miss, which is usually a
  // create-message request, for the length of a ~335KB Redis write it has no
  // use for.
  void setCache(CACHE_KEYS.openRouterModels, modelData);
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
// TODO: check this for perf issues since its in message-creation pipeline.
export async function validateChatModelInput(
  modelId: string,
  requiredModality: InputModality,
): Promise<boolean> {
  const model = await findChatModel(modelId);
  return Boolean(model?.inputModalities.includes(requiredModality));
}

const MAX_TITLE_INPUT_CHARS = 12_000;
const DEFAULT_TITLE_GENERATION_MODEL = "openai/gpt-4o-mini";

export async function generateTitle(
  kind: "conversation" | "transcript",
  content: string,
): Promise<string> {
  const title = await chatAI(
    DEFAULT_TITLE_GENERATION_MODEL,
    [
      {
        role: "user",
        content: `Generate a concise, descriptive title of at most eight words for this ${kind}. Return only the title.\n\n${content.slice(0, MAX_TITLE_INPUT_CHARS)}`,
      },
    ],
    { maxOutputTokens: 24, timeoutMs: TITLE_TIMEOUT_MS },
  );

  return title.trim();
}
