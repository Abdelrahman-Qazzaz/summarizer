import { Link } from "react-router-dom";
import type { JobSummary } from "../../lib/jobs";
import { JobStatus } from "../job/JobStatus";
import { useDeleteJobMutation } from "../../hooks/queries/useJobMutations";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function HistoryRow({ job }: { job: JobSummary }) {
  const deleteMutation = useDeleteJobMutation();

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.confirm(`Delete “${job.fileName}”? This can't be undone.`)) {
      deleteMutation.mutate(job.uploadId);
    }
  };

  return (
    <Link
      to={`/jobs/${job.uploadId}`}
      className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all"
    >
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 capitalize">
        {job.kind}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {job.fileName}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {formatDate(job.createdAt)}
          {job.chosenModelId ? ` · ${job.chosenModelId}` : ""}
        </p>
      </div>

      <div className="hidden sm:block">
        <JobStatus status={job.status} />
      </div>

      <button
        onClick={handleDelete}
        disabled={deleteMutation.isPending}
        aria-label="Delete job"
        className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </Link>
  );
}
