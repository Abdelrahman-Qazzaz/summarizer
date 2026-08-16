import {
  chatModelsEndpoint,
  transcriptionModelsEndpoint,
} from "../config";

export type ModelPricing = {
  prompt?: string;
  completion?: string;
  audio?: string;
  audioOutput?: string;
  image?: string;
  imageOutput?: string;
  imageToken?: string;
  inputAudioCache?: string;
  inputCacheRead?: string;
  inputCacheWrite?: string;
  internalReasoning?: string;
  discount?: number;
  request?: string;
  webSearch?: string;
};

export type ModelTopProvider = {
  contextLength?: number | null;
  isModerated?: boolean;
  maxCompletionTokens?: number | null;
};

export type ModelInfo = {
  id?: string;
  name?: string;
  description?: string;
  knowledgeCutoff?: string | null;
  topProvider?: ModelTopProvider;
  pricing?: ModelPricing;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
};

export type ModelsResponse = {
  modelData: Record<string, ModelInfo>;
};

export type TranscriptionModelInfo = {
  name: string;
  canonicalName: string;
  architecture?: string;
  languages?: string[];
  version?: string;
  uuid?: string;
  batch?: boolean;
  streaming?: boolean;
  formattedOutput?: boolean;
};

export type TranscriptionModelsResponse = {
  transcriptionModelData: Record<string, TranscriptionModelInfo>;
};

async function fetchModelData<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : response.statusText;
    throw new Error(
      message || `Failed to load models (${response.status})`,
    );
  }
  return data as T;
}

export async function fetchChatModels(): Promise<ModelsResponse> {
  const data = await fetchModelData<ModelsResponse>(chatModelsEndpoint());
  if (!data?.modelData || typeof data.modelData !== "object") {
    throw new Error("Invalid chat models response");
  }
  return data;
}

export async function fetchTranscriptionModels(): Promise<TranscriptionModelsResponse> {
  const data = await fetchModelData<TranscriptionModelsResponse>(
    transcriptionModelsEndpoint(),
  );
  if (
    !data?.transcriptionModelData ||
    typeof data.transcriptionModelData !== "object"
  ) {
    throw new Error("Invalid transcription models response");
  }
  return data;
}
