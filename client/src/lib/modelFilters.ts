import type { ModelInfo } from "./models";
import type { SourceMode } from "../sourceMode";

export const DEFAULT_TEXT_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";

export type ModelEntry = [name: string, info: ModelInfo];

function isTranscriptionName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("transcribe") || lower.includes("whisper");
}

export function isTranscriptionModel(name: string, info: ModelInfo): boolean {
  // Prefer the real capability metadata the API now exposes; fall back to
  // heuristics only when a model lacks outputModalities.
  const modalities = info.outputModalities;
  if (modalities && modalities.length > 0) {
    return modalities.includes("transcription");
  }
  if (isTranscriptionName(name)) return true;
  const pricing = info.pricing;
  if (pricing?.audio && !pricing.completion) return true;
  return false;
}

export function isTextModel(name: string, info: ModelInfo): boolean {
  const modalities = info.outputModalities;
  if (modalities && modalities.length > 0) {
    return modalities.includes("text");
  }
  if (isTranscriptionModel(name, info)) return false;
  const pricing = info.pricing;
  if (pricing?.prompt && pricing.completion) return true;
  const params = info.supportedParameters ?? [];
  return params.includes("temperature") || params.includes("max_tokens");
}

export function filterModelsForMode(
  entries: ModelEntry[],
  mode: SourceMode,
): ModelEntry[] {
  const filter = mode === "text" ? isTextModel : isTranscriptionModel;
  return entries.filter(([name, info]) => filter(name, info));
}

export function defaultModelForMode(mode: SourceMode): string {
  return mode === "text" ? DEFAULT_TEXT_MODEL : DEFAULT_TRANSCRIPTION_MODEL;
}

export function resolveDefaultModel(
  entries: ModelEntry[],
  mode: SourceMode,
): string {
  const filtered = filterModelsForMode(entries, mode);
  const preferred = defaultModelForMode(mode);
  if (filtered.some(([name]) => name === preferred)) return preferred;
  if (filtered.length > 0) return filtered[0][0];
  return preferred;
}

export function modelLabelForMode(mode: SourceMode): string {
  return mode === "text" ? "Summarization model" : "Transcription model";
}
