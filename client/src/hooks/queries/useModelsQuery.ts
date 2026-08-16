import { useQuery } from "@tanstack/react-query";
import {
  fetchChatModels,
  fetchTranscriptionModels,
  type ModelInfo,
  type TranscriptionModelInfo,
} from "../../lib/models";
import { queryKeys } from "../../lib/queryClient";

export type ChatModelEntry = [name: string, info: ModelInfo];
export type TranscriptionModelEntry = [
  name: string,
  info: TranscriptionModelInfo,
];

/** Fetches the available models and exposes them as sorted [name, info] entries. */
export function useChatModelsQuery(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.chatModels,
    queryFn: fetchChatModels,
    enabled,
    staleTime: 5 * 60_000,
  });

  const entries: ChatModelEntry[] = query.data
    ? Object.entries(query.data.modelData).sort(([a], [b]) =>
        a.localeCompare(b),
      )
    : [];

  return {
    entries,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

export function useTranscriptionModelsQuery(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.transcriptionModels,
    queryFn: fetchTranscriptionModels,
    enabled,
    staleTime: 5 * 60_000,
  });

  const entries: TranscriptionModelEntry[] = query.data
    ? Object.entries(query.data.transcriptionModelData).sort(([first], [second]) =>
        first.localeCompare(second),
      )
    : [];

  return {
    entries,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
