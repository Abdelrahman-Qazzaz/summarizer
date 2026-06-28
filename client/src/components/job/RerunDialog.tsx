import { useState } from "react";
import { useAuth } from "../../hooks/auth/useAuth";
import { useModelsQuery } from "../../hooks/queries/useModelsQuery";
import { ModelSelector } from "../models/ModelSelector";
import {
  filterModelsForMode,
  modelLabelForMode,
  resolveDefaultModel,
} from "../../lib/modelFilters";
import type { JobKind } from "../../lib/jobs";
import type { SourceMode } from "../../sourceMode";

type RerunDialogProps = {
  kind: JobKind;
  currentModelId?: string | null;
  isPending: boolean;
  onConfirm: (modelId: string) => void;
  onClose: () => void;
};

export function RerunDialog({
  kind,
  currentModelId,
  isPending,
  onConfirm,
  onClose,
}: RerunDialogProps) {
  const { user } = useAuth();
  const { entries, loading, error } = useModelsQuery(!!user);
  // Re-running re-processes the original upload, so model choices follow its kind.
  const mode: SourceMode = kind === "audio" ? "audio" : "text";
  // `null` means "not yet chosen" — fall back to the default for this mode.
  const [picked, setPicked] = useState<string | null>(currentModelId ?? null);
  const model =
    picked ?? (entries.length > 0 ? resolveDefaultModel(entries, mode) : null);

  const modelOptions = filterModelsForMode(entries, mode).map(([id, info]) => ({
    id,
    label: id,
    info,
  }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Re-run job</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Re-process the original upload with a different model.
          </p>
        </div>

        <ModelSelector
          label={modelLabelForMode(mode)}
          models={modelOptions}
          value={model}
          onChange={setPicked}
          disabled={loading || isPending}
          loading={loading}
          error={error}
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-xl text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => model && onConfirm(model)}
            disabled={!model || isPending}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {isPending ? "Starting…" : "Re-run"}
          </button>
        </div>
      </div>
    </div>
  );
}
