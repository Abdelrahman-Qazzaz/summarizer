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

/** Staging an image narrows the picker to models that accept vision input. */
export function canChatWithImages(modelInfo: ModelInfo): boolean {
  return (
    canChatWithText(modelInfo) &&
    (modelInfo.inputModalities?.includes("image") ?? false)
  );
}
