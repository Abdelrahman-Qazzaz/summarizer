import { useState } from "react";
import { useJobQuery } from "../../hooks/queries/useJobQueries";
import { downloadTextFile, resultFileName } from "../../lib/download";
import { Icon } from "../ui/Icon";
import { Meter } from "../ui/Meter";

/** The transcript body, read-only — the panel the library rows open into. */
export function TranscriptView({
  uploadId,
  onBack,
  onAttach,
}: {
  uploadId: string;
  onBack: () => void;
  onAttach: (fileName: string) => void;
}) {
  const jobQuery = useJobQuery(uploadId);
  const [copied, setCopied] = useState(false);
  const job = jobQuery.data;

  const copy = async () => {
    if (!job?.transcript) return;
    await navigator.clipboard.writeText(job.transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-sunk hover:text-ink"
          aria-label="Back to sources"
        >
          <Icon name="chevronDown" className="h-4 w-4 rotate-90" />
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {job?.fileName ?? "Loading…"}
        </p>
      </div>

      {jobQuery.isLoading ? (
        <p className="p-4 text-sm text-faint">Loading transcript…</p>
      ) : jobQuery.error || !job ? (
        <p className="p-4 text-sm text-live">This source couldn't be loaded.</p>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <Meter
              state={
                job.status === "failed"
                  ? "failed"
                  : job.status === "completed"
                    ? "ready"
                    : "live"
              }
            />
            <span className="text-[11px] text-faint">
              {job.status === "completed" && job.transcript
                ? `${job.transcript.length.toLocaleString()} chars`
                : job.status}
            </span>
            <span className="flex-1" />
            {job.status === "completed" && job.transcript && (
              <>
                <button
                  type="button"
                  onClick={() => onAttach(job.fileName)}
                  className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-signal hover:text-ink"
                >
                  Attach
                </button>
                <button
                  type="button"
                  onClick={() => void copy()}
                  aria-label={copied ? "Transcript copied" : "Copy transcript"}
                  className="rounded-md p-1.5 text-muted transition-colors hover:bg-sunk hover:text-ink"
                >
                  <Icon
                    name={copied ? "check" : "copy"}
                    className="h-3.5 w-3.5"
                  />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      resultFileName(job.fileName, "transcript"),
                      job.transcript ?? "",
                    )
                  }
                  aria-label="Download transcript"
                  className="rounded-md p-1.5 text-muted transition-colors hover:bg-sunk hover:text-ink"
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {job.status === "failed" ? (
              <p className="text-sm text-live">
                {job.error ?? "This transcription failed."}
              </p>
            ) : job.transcript ? (
              <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
                {job.transcript}
              </p>
            ) : (
              <p className="text-sm text-faint">
                Still working — the transcript appears here when it lands.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
