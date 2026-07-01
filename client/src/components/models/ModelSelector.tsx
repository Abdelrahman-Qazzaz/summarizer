import { useMemo, useState } from "react";
import type { ModelInfo } from "../../lib/models";

export type ModelOption = {
  id: string;
  label: string;
  info: ModelInfo;
};

type ModelSelectorProps = {
  label: string;
  models: ModelOption[];
  value: string | null;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
};

const SEARCH_THRESHOLD = 30;

function formatPricing(info: ModelInfo): string | null {
  const pricing = info.pricing;
  if (!pricing) return null;

  const parts: string[] = [];
  if (pricing.prompt) parts.push(`prompt ${pricing.prompt}`);
  if (pricing.completion) parts.push(`completion ${pricing.completion}`);
  if (pricing.audio) parts.push(`audio ${pricing.audio}`);

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ModelSelector({
  label,
  models,
  value,
  onChange,
  disabled,
  loading,
  error,
}: ModelSelectorProps) {
  const [search, setSearch] = useState("");

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter(
      ({ id, label: modelLabel, info }) =>
        id.toLowerCase().includes(query) ||
        modelLabel.toLowerCase().includes(query) ||
        info.description?.toLowerCase().includes(query),
    );
  }, [models, search]);

  const selected = models.find((m) => m.id === value) ?? null;
  const showSearch = models.length > SEARCH_THRESHOLD;

  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </p>
        <div className="h-11 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </p>
        <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl">
          <svg
            className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No models available for this mode.
        </p>
      </div>
    );
  }

  const contextLength = selected?.info.topProvider?.contextLength;
  const pricing = selected ? formatPricing(selected.info) : null;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          AI model
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      </div>

      {showSearch && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models…"
          disabled={disabled}
          className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700
            bg-white dark:bg-gray-800 text-gray-900 dark:text-white
            placeholder:text-gray-400 dark:placeholder:text-gray-500
            focus:outline-none focus:ring-2 focus:ring-primary-500/40
            disabled:opacity-50 disabled:cursor-not-allowed"
        />
      )}

      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700
          bg-white dark:bg-gray-800 text-gray-900 dark:text-white
          focus:outline-none focus:ring-2 focus:ring-primary-500/40
          disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {filteredModels.length === 0 ? (
          <option value="">No models match your search</option>
        ) : (
          filteredModels.map(({ id, label: modelLabel }) => (
            <option key={id} value={id}>
              {modelLabel}
            </option>
          ))
        )}
      </select>

      {selected && (
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          {selected.info.description && <p>{selected.info.description}</p>}
          {contextLength != null && (
            <p>Context: {contextLength.toLocaleString()} tokens</p>
          )}
          {pricing && <p>Pricing: {pricing}</p>}
        </div>
      )}
    </div>
  );
}
