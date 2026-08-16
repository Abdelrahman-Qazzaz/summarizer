import type { ModelInfo } from "./models";

export const DEFAULT_TEXT_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_TRANSCRIPTION_MODEL = "nova-3";

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
