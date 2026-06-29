import { useState } from "react";
import { useAuth } from "../../hooks/auth/useAuth";
import { useModelsQuery } from "../../hooks/queries/useModelsQuery";
import { ModelSelector } from "../models/ModelSelector";
import {
  filterModelsForMode,
  modelLabelForMode,
  resolveDefaultModel,
} from "../../lib/modelFilters";
import type { JobKind, RerunModels } from "../../lib/jobs";

type RerunDialogProps = {
  kind: JobKind;
  isPending: boolean;
  onConfirm: (models: RerunModels) => void;
  onClose: () => void;
};

export function RerunDialog({
  kind,
  isPending,
  onConfirm,
  onClose,
}: RerunDialogProps) {
  const { user } = useAuth();
  const { entries, loading, error } = useModelsQuery(!!user);
  const isAudio = kind === "audio";

  // Summarization model — both kinds re-summarize. (`null` = not yet chosen.)
  const [summaryPick, setSummaryPick] = useState<string | null>(null);
  const summaryModel =
    summaryPick ??
    (entries.length > 0 ? resolveDefaultModel(entries, "text") : null);
  const summaryOptions = filterModelsForMode(entries, "text").map(
    ([id, info]) => ({ id, label: id, info }),
  );

  // Transcription model — audio jobs re-transcribe before re-summarizing.
  const [transcriptionPick, setTranscriptionPick] = useState<string | null>(
    null,
  );
  const transcriptionModel =
    transcriptionPick ??
    (entries.length > 0 ? resolveDefaultModel(entries, "audio") : null);
  const transcriptionOptions = filterModelsForMode(entries, "audio").map(
    ([id, info]) => ({ id, label: id, info }),
  );

  const canSubmit =
    !!summaryModel && (!isAudio || !!transcriptionModel) && !isPending;

  const handleConfirm = () => {
    if (!summaryModel) return;
    if (isAudio) {
      if (!transcriptionModel) return;
      onConfirm({
        chosenModelId: summaryModel,
        transcriptionModelId: transcriptionModel,
      });
    } else {
      onConfirm({ chosenModelId: summaryModel });
    }
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
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Re-run job</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isAudio
              ? "Re-transcribe the audio and re-summarize the result."
              : "Re-summarize the original upload with a different model."}
          </p>
        </div>

        {isAudio && (
          <ModelSelector
            label={modelLabelForMode("audio")}
            models={transcriptionOptions}
            value={transcriptionModel}
            onChange={setTranscriptionPick}
            disabled={loading || isPending}
            loading={loading}
            error={error}
          />
        )}

        <ModelSelector
          label={modelLabelForMode("text")}
          models={summaryOptions}
          value={summaryModel}
          onChange={setSummaryPick}
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
