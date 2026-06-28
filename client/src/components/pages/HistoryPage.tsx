import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/auth/useAuth";
import { useJobsQuery } from "../../hooks/queries/useJobsQuery";
import { HistoryRow } from "../history/HistoryRow";
import type { JobKind, JobStatus } from "../../lib/jobs";

type StatusFilter = JobStatus | "all";
type KindFilter = JobKind | "all";

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const kindOptions: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "text", label: "Text" },
  { value: "audio", label: "Audio" },
];

const selectClass =
  "px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40";

export function HistoryPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useJobsQuery(!!user, {
      status: status === "all" ? null : status,
      kind: kind === "all" ? null : kind,
      q: q.trim() || null,
    });

  // Flatten pages and apply the same filters client-side as a fallback in case
  // the backend doesn't support server-side filtering yet.
  const jobs = useMemo(() => {
    const all = data?.pages.flatMap((page) => page.jobs) ?? [];
    const query = q.trim().toLowerCase();
    return all.filter(
      (job) =>
        (status === "all" || job.status === status) &&
        (kind === "all" || job.kind === kind) &&
        (!query || job.fileName.toLowerCase().includes(query)),
    );
  }, [data, q, status, kind]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          History
        </h1>
        <Link
          to="/app"
          className="px-4 py-2 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          New summary
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by file name…"
          className={`${selectClass} flex-1 min-w-[12rem]`}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectClass}>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} className={selectClass}>
          {kindOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[68px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-6 text-center bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl">
          <p className="text-sm text-red-700 dark:text-red-300">
            {error instanceof Error ? error.message : "Failed to load history."}
          </p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl">
          <p className="text-gray-600 dark:text-gray-300 font-medium">No jobs yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your processed files will appear here.
          </p>
          <Link
            to="/app"
            className="inline-block mt-4 px-4 py-2 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            Create your first summary
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {jobs.map((job) => (
              <HistoryRow key={job.uploadId} job={job} />
            ))}
          </div>
          {hasNextPage && (
            <div className="text-center">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-5 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
