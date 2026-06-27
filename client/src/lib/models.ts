import { modelsEndpoint } from "../config";

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
  description?: string;
  knowledgeCutoff?: string | null;
  topProvider?: ModelTopProvider;
  pricing?: ModelPricing;
  supportedParameters?: string[];
  outputModalities?: string[];
};

export type ModelsResponse = {
  modelData: Record<string, ModelInfo>;
};

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(modelsEndpoint(), { credentials: "include" });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : res.statusText;
    throw new Error(message || `Failed to load models (${res.status})`);
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("modelData" in data) ||
    typeof (data as ModelsResponse).modelData !== "object"
  ) {
    throw new Error("Invalid models response");
  }
  return data as ModelsResponse;
}
