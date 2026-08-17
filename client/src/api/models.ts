import { chatModelsEndpoint, transcriptionModelsEndpoint } from "../config";
import { apiJson } from "./http";

export type ModelPricing = {
  prompt?: string;
  completion?: string;
  audio?: string;
  image?: string;
  request?: string;
  webSearch?: string;
};

export type ModelInfo = {
  id?: string;
  name?: string;
  description?: string;
  knowledgeCutoff?: string | null;
  topProvider?: {
    contextLength?: number | null;
    isModerated?: boolean;
    maxCompletionTokens?: number | null;
  };
  pricing?: ModelPricing;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
};

export type TranscriptionModelInfo = {
  name: string;
  canonicalName: string;
  architecture?: string;
  languages?: string[];
  version?: string;
  batch?: boolean;
  streaming?: boolean;
  formattedOutput?: boolean;
};

export const DEFAULT_TEXT_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_TRANSCRIPTION_MODEL = "nova-3";

export async function fetchChatModels(): Promise<Record<string, ModelInfo>> {
  const data = await apiJson<{ modelData: Record<string, ModelInfo> }>(
    chatModelsEndpoint(),
  );
  if (!data?.modelData || typeof data.modelData !== "object") {
    throw new Error("Invalid chat models response");
  }
  return data.modelData;
}

export async function fetchTranscriptionModels(): Promise<
  Record<string, TranscriptionModelInfo>
> {
  const data = await apiJson<{
    transcriptionModelData: Record<string, TranscriptionModelInfo>;
  }>(transcriptionModelsEndpoint());
  if (
    !data?.transcriptionModelData ||
    typeof data.transcriptionModelData !== "object"
  ) {
    throw new Error("Invalid transcription models response");
  }
  return data.transcriptionModelData;
}

/** Fall back to the first available model when the preferred one isn't offered. */
export function resolveDefaultModel(
  modelIds: string[],
  preferredModelId: string,
): string | null {
  if (modelIds.includes(preferredModelId)) return preferredModelId;
  return modelIds[0] ?? null;
}

export function canChatWithText(modelInfo: ModelInfo): boolean {
  return modelInfo.outputModalities?.includes("text") ?? false;
}

export function canChatWithImages(modelInfo: ModelInfo): boolean {
  return (
    canChatWithText(modelInfo) &&
    (modelInfo.inputModalities?.includes("image") ?? false)
  );
}

/* ------------------------------------------------------------------ naming */

// OpenRouter ids are "<provider>/<model>" and its names are "Provider: Model",
// so both the grouping key and a clean display name come from the catalog
// itself. This map only covers the fallback path, where a name arrives without
// its prefix.
const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "meta-llama": "Meta",
  mistralai: "Mistral",
  deepseek: "DeepSeek",
  "x-ai": "xAI",
  qwen: "Qwen",
  cohere: "Cohere",
  perplexity: "Perplexity",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  amazon: "Amazon",
  ai21: "AI21",
};

export function providerSlug(modelId: string): string {
  const [slug] = modelId.split("/");
  return slug && slug !== modelId ? slug : "other";
}

function labelForSlug(slug: string): string {
  if (PROVIDER_LABELS[slug]) return PROVIDER_LABELS[slug];
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** "Anthropic: Claude Sonnet 4.5" becomes { provider, name } for display. */
export function describeModel(
  modelId: string,
  info: ModelInfo,
): { provider: string; name: string } {
  const raw = (info.name ?? "").trim() || modelId;
  const separator = raw.indexOf(": ");
  if (separator > 0) {
    return {
      provider: raw.slice(0, separator).trim(),
      name: raw.slice(separator + 2).trim(),
    };
  }
  return { provider: labelForSlug(providerSlug(modelId)), name: raw };
}

/* ----------------------------------------------------------- capabilities */

export type ModelCapability = "image" | "file" | "audio" | "reasoning";

export function modelCapabilities(info: ModelInfo): ModelCapability[] {
  const inputs = info.inputModalities ?? [];
  const parameters = info.supportedParameters ?? [];
  const capabilities: ModelCapability[] = [];
  if (inputs.includes("image")) capabilities.push("image");
  if (inputs.includes("file")) capabilities.push("file");
  if (inputs.includes("audio")) capabilities.push("audio");
  if (
    parameters.includes("reasoning") ||
    parameters.includes("include_reasoning")
  ) {
    capabilities.push("reasoning");
  }
  return capabilities;
}

export function contextLength(info: ModelInfo): number | null {
  return info.topProvider?.contextLength ?? null;
}

/**
 * A rough price band from the prompt price (USD per token), so the list can
 * show cost at a glance the way it shows capability. Null when unpriced.
 */
export function priceTier(info: ModelInfo): number | null {
  const perToken = Number(info.pricing?.prompt);
  if (!Number.isFinite(perToken)) return null;
  const perMillion = perToken * 1_000_000;
  if (perMillion <= 0) return 0;
  if (perMillion < 1) return 1;
  if (perMillion < 5) return 2;
  if (perMillion < 20) return 3;
  return 4;
}

/* ---------------------------------------------------- message requirements */

/**
 * What the message being written needs from a model. Derived from what the
 * composer is actually carrying, so the picker can hide models that would be
 * rejected — the API refuses a turn whose model can't read an attached image,
 * and a transcript longer than the context window is wasted spend.
 */
export type MessageRequirements = {
  image: boolean;
  /** Rough token estimate of the prompt this turn will send. */
  tokens: number;
};

/** Four characters per token is the usual English approximation. */
export const CHARS_PER_TOKEN = 4;

export function meetsRequirements(
  info: ModelInfo,
  requirements: MessageRequirements,
): boolean {
  if (!canChatWithText(info)) return false;
  if (requirements.image && !canChatWithImages(info)) return false;
  const limit = contextLength(info);
  // An unknown context length is not evidence the model is too small.
  if (limit !== null && requirements.tokens > limit) return false;
  return true;
}
