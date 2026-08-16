import { useState } from "react";
import { useAuth } from "../../hooks/auth/useAuth";
import { useTranscriptionModelsQuery } from "../../hooks/queries/useModelsQuery";
import { ModelSelector } from "../models/ModelSelector";
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  resolveDefaultModel,
} from "../../lib/modelFilters";

type RerunDialogProps = {
  isPending: boolean;
  onConfirm: (transcriptionModelId: string) => void;
  onClose: () => void;
};

export function RerunDialog({
  isPending,
  onConfirm,
  onClose,
}: RerunDialogProps) {
  const { user } = useAuth();
  const { entries, loading, error } = useTranscriptionModelsQuery(!!user);
  const [transcriptionPick, setTranscriptionPick] = useState<string | null>(
    null,
  );
  const transcriptionModel =
    transcriptionPick ??
    resolveDefaultModel(
      entries.map(([modelId]) => modelId),
      DEFAULT_TRANSCRIPTION_MODEL,
    );
  const transcriptionOptions = entries.map(([id, info]) => ({
    id,
    label: info.name || id,
    info: {
      description: [
        info.architecture,
        info.languages?.length ? `${info.languages.length} languages` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  }));

  const canSubmit = !!transcriptionModel && !isPending;

  const handleConfirm = () => {
    if (transcriptionModel) onConfirm(transcriptionModel);
  };

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
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Re-run job
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Transcribe the original audio again with a different model.
          </p>
        </div>

        <ModelSelector
          label="Transcription model"
          models={transcriptionOptions}
          value={transcriptionModel}
          onChange={setTranscriptionPick}
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
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {isPending ? "Starting…" : "Re-run"}
          </button>
        </div>
      </div>
    </div>
  );
}
