import { useEffect, useState } from "react";
import type { JobSource } from "../../api/jobs";
import { useAuth } from "../../hooks/auth/useAuth";
import { useTranscriptionModelsQuery } from "../../hooks/queries/useModelsQuery";

type RerunDialogProps = {
  fileName: string;
  source: JobSource;
  currentModelId: string | null;
  onConfirm: (
    transcriptModelId: string,
    useCaptionsIfAvailable: boolean,
  ) => void;
  onCancel: () => void;
};

/** Replaces a transcript using stored audio or the original YouTube source. */
export function RerunDialog({
  fileName,
  source,
  currentModelId,
  onConfirm,
  onCancel,
}: RerunDialogProps) {
  const { user } = useAuth();
  const { entries } = useTranscriptionModelsQuery(!!user);
  const [modelId, setModelId] = useState(currentModelId ?? "");
  const [useCaptionsIfAvailable, setUseCaptionsIfAvailable] = useState(
    source === "youtube",
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transcribe again"
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">Transcribe again</h2>
        <p className="mt-2 text-sm text-muted">
          The current transcript for{" "}
          <span className="font-mono text-[12px]">{fileName}</span> is replaced.
        </p>

        {source === "youtube" && (
          <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-line bg-canvas px-3 py-2.5">
            <input
              type="checkbox"
              checked={useCaptionsIfAvailable}
              onChange={(event) =>
                setUseCaptionsIfAvailable(event.target.checked)
              }
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                Use captions if available
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                Skips the audio download when YouTube provides captions.
              </span>
            </span>
          </label>
        )}

        <label
          htmlFor="rerun-model"
          className="eyebrow mt-4 block pb-1.5 text-faint"
        >
          {source === "youtube" && useCaptionsIfAvailable
            ? "Fallback model"
            : "Model"}
        </label>
        <select
          id="rerun-model"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 font-mono text-[12px] outline-none"
        >
          {entries.length === 0 ? (
            <option value="">Loading…</option>
          ) : (
            entries.map(([id, info]) => (
              <option key={id} value={id}>
                {info.name || id}
              </option>
            ))
          )}
        </select>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-sunk hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!modelId}
            onClick={() => onConfirm(modelId, useCaptionsIfAvailable)}
            className="rounded-lg bg-signal px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
