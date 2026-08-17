import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchChatModels,
  fetchTranscriptionModels,
  type ModelInfo,
  type TranscriptionModelInfo,
} from "../../api/models";
import { queryKeys } from "../../lib/queryClient";

export type ChatModelEntry = [id: string, info: ModelInfo];
export type TranscriptionModelEntry = [id: string, info: TranscriptionModelInfo];

/** The available models as sorted [id, info] entries, stable across renders. */
export function useChatModelsQuery(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.chatModels,
    queryFn: fetchChatModels,
    enabled,
    staleTime: 5 * 60_000,
  });

  const entries = useMemo<ChatModelEntry[]>(
    () =>
      query.data
        ? Object.entries(query.data).sort(([first], [second]) =>
            first.localeCompare(second),
          )
        : [],
    [query.data],
  );

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

  const entries = useMemo<TranscriptionModelEntry[]>(
    () =>
      query.data
        ? Object.entries(query.data).sort(([first], [second]) =>
            first.localeCompare(second),
          )
        : [],
    [query.data],
  );

  return {
    entries,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
