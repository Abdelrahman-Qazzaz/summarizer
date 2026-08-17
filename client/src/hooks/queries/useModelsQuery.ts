import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchChatModels,
  fetchTranscriptionModels,
  type ModelInfo,
  type TranscriptionModelInfo,
} from "../../api/models";
import { queryKeys } from "../../lib/queryClient";

/**
 * The catalog changes about daily and the API now serves it with an ETag,
 * so a stale check costs a 304 with no body rather than ~40KB.
 */
const MODEL_CATALOG_STALE_MS = 60 * 60_000;

export type ChatModelEntry = [id: string, info: ModelInfo];
export type TranscriptionModelEntry = [id: string, info: TranscriptionModelInfo];

/** The available models as sorted [id, info] entries, stable across renders. */
export function useChatModelsQuery(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.chatModels,
    queryFn: fetchChatModels,
    enabled,
    staleTime: MODEL_CATALOG_STALE_MS,
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
    staleTime: MODEL_CATALOG_STALE_MS,
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
