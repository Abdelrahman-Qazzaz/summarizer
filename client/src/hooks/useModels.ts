import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchModels, type ModelInfo } from "../lib/models";

export type ModelEntry = [name: string, info: ModelInfo];

export function useModels(enabled: boolean) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelData, setModelData] = useState<Record<string, ModelInfo> | null>(
    null,
  );

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchModels();
      setModelData(res.modelData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModelData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadModels();
  }, [enabled, loadModels]);

  const entries = useMemo<ModelEntry[]>(() => {
    if (!modelData) return [];
    return Object.entries(modelData).sort(([a], [b]) => a.localeCompare(b));
  }, [modelData]);

  return { loading, error, modelData, entries };
}
