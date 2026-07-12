import { Link } from "react-router-dom";
import { useJobQuery } from "../../hooks/queries/useJobQuery";
import { JobStatus } from "../job/JobStatus";
import type { QueueItem } from "../../hooks/upload/context";

type QueueItemRowProps = {
  item: QueueItem;
  onRemove: (id: string) => void;
};

const phaseLabel: Record<NonNullable<QueueItem["phase"]>, string> = {
  extract: "Extracting audio…",
  compress: "Compressing audio…",
  upload: "Uploading…",
};

function ModeBadge({ mode }: { mode: QueueItem["mode"] }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 capitalize">
      {mode === "youtube" ? "YouTube" : mode}
    </span>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Remove from queue"
      className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

/** A single row in the upload queue. Tracks live job status once uploaded. */
export function QueueItemRow({ item, onRemove }: QueueItemRowProps) {
  const { data: job } = useJobQuery(item.uploadId);

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {item.fileName}
          </p>
          <ModeBadge mode={item.mode} />
        </div>

        <div className="mt-1">
          {item.status === "processing" && (
            <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {item.phase ? phaseLabel[item.phase] : "Preparing…"}
            </p>
          )}

          {item.status === "error" && (
            <p className="text-xs text-red-600 dark:text-red-400">{item.error}</p>
          )}

          {item.status === "uploaded" && (
            <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
              {job ? job.status : "Queued…"}
            </p>
          )}
        </div>
      </div>

      {item.status === "uploaded" && job && (
        <div className="hidden sm:block">
          <JobStatus status={job.status} />
        </div>
      )}

      {item.status === "uploaded" && item.uploadId && (
        <Link
          to={`/jobs/${item.uploadId}`}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          View
        </Link>
      )}

      {item.status !== "processing" && <RemoveButton onClick={() => onRemove(item.id)} />}
    </div>
  );
}
