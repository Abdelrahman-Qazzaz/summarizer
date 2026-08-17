import { useEffect, useState } from "react";
import type { JobStatus } from "../../api/jobs";
import { useAuth } from "../../hooks/auth/useAuth";
import {
  useDeleteJobMutation,
  useJobsQuery,
  useRerunJobMutation,
} from "../../hooks/queries/useJobQueries";
import { useToast } from "../../hooks/toast/useToast";
import { useSources } from "../../sources/useSources";
import { useShell } from "../app/shellContext";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { RerunDialog } from "./RerunDialog";
import { SourceRow } from "./SourceRow";
import { useDraftKey } from "./useDraftKey";

const FILTERS: { label: string; status: JobStatus | null }[] = [
  { label: "All", status: null },
  { label: "Ready", status: "completed" },
  { label: "Failed", status: "failed" },
];

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Every transcript the user owns, and the one place a finished one gets pulled
 * onto the message being written — no second upload, no second transcription.
 */
export function SourcesDrawer() {
  const { setSourcesOpen, openSource, setOpenSource } = useShell();
  const { user } = useAuth();
  const toast = useToast();
  const draftKey = useDraftKey();
  const { attachExisting, transcriptModelId } = useSources(draftKey);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [rerunTarget, setRerunTarget] = useState<{
    uploadId: string;
    fileName: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    uploadId: string;
    fileName: string;
  } | null>(null);

  const jobsQuery = useJobsQuery(!!user, {
    status,
    q: debouncedSearch || null,
  });
  const deleteJob = useDeleteJobMutation();
  const rerunJob = useRerunJobMutation();

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  // Escape closes the drawer, but only once whatever is stacked on top of it
  // has taken its own turn.
  const dialogOpen = !!rerunTarget || !!deleteTarget || !!openSource;
  useEffect(() => {
    if (dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSourcesOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, setSourcesOpen]);

  const jobs = jobsQuery.data?.pages.flatMap((page) => page.jobs) ?? [];

  const attach = (uploadId: string, fileName: string) => {
    // The list doesn't carry a source kind, so this stages as plain audio; the
    // sent turn shows what it really was once the server answers.
    attachExisting({ uploadId, fileName, source: "audio" });
    toast.show({ kind: "success", message: `${fileName} added to the message.` });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close sources"
        onClick={() => setSourcesOpen(false)}
        className="fixed inset-0 z-40 bg-ink/30"
      />

      <aside
        aria-label="Sources"
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-canvas shadow-xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <h2 className="eyebrow text-ink">Sources</h2>
          <button
            type="button"
            onClick={() => setSourcesOpen(false)}
            aria-label="Close sources"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-sunk hover:text-ink"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 space-y-3 px-4 pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
            <Icon name="search" className="h-4 w-4 shrink-0 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by file name"
              aria-label="Search sources"
              className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>

          <div className="flex gap-1.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.label}
                type="button"
                onClick={() => setStatus(filter.status)}
                aria-pressed={status === filter.status}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  status === filter.status
                    ? "bg-signal-tint text-signal-strong"
                    : "text-muted hover:bg-sunk hover:text-ink"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
          {jobsQuery.isLoading ? (
            <p className="p-4 text-sm text-faint">Loading sources…</p>
          ) : jobsQuery.error ? (
            <p className="p-4 text-sm text-live">Sources couldn't be loaded.</p>
          ) : jobs.length === 0 ? (
            <p className="p-4 text-sm text-faint">
              {debouncedSearch || status
                ? "Nothing matches that."
                : "Drop a recording into a message and it shows up here."}
            </p>
          ) : (
            <>
              <ul>
                {jobs.map((job) => (
                  <SourceRow
                    key={job.uploadId}
                    job={job}
                    onOpen={() =>
                      setOpenSource({
                        kind: "transcript",
                        uploadId: job.uploadId,
                        fileName: job.fileName,
                      })
                    }
                    onAttach={() => attach(job.uploadId, job.fileName)}
                    onRerun={() =>
                      setRerunTarget({
                        uploadId: job.uploadId,
                        fileName: job.fileName,
                      })
                    }
                    onDelete={() =>
                      setDeleteTarget({
                        uploadId: job.uploadId,
                        fileName: job.fileName,
                      })
                    }
                  />
                ))}
              </ul>
              {jobsQuery.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void jobsQuery.fetchNextPage()}
                  disabled={jobsQuery.isFetchingNextPage}
                  className="w-full px-4 py-3 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50"
                >
                  {jobsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      </aside>

      {rerunTarget && (
        <RerunDialog
          fileName={rerunTarget.fileName}
          currentModelId={transcriptModelId}
          onConfirm={(modelId) => {
            rerunJob.mutate({
              uploadId: rerunTarget.uploadId,
              transcriptModelId: modelId,
            });
            setRerunTarget(null);
          }}
          onCancel={() => setRerunTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this source?"
          body={`“${deleteTarget.fileName}” and its transcript are removed. Messages already sent with it keep their copy.`}
          confirmLabel="Delete source"
          onConfirm={() => {
            deleteJob.mutate({ uploadId: deleteTarget.uploadId });
            if (
              openSource?.kind === "transcript" &&
              openSource.uploadId === deleteTarget.uploadId
            ) {
              setOpenSource(null);
            }
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
