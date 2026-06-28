import { useQuery } from "@tanstack/react-query";
import { fetchModels, type ModelInfo } from "../../lib/models";
import { queryKeys } from "../../lib/queryClient";

export type ModelEntry = [name: string, info: ModelInfo];

/** Fetches the available models and exposes them as sorted [name, info] entries. */
export function useModelsQuery(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.models,
    queryFn: fetchModels,
    enabled,
    staleTime: 5 * 60_000,
  });

  const entries: ModelEntry[] = query.data
    ? Object.entries(query.data.modelData).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return {
    entries,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
