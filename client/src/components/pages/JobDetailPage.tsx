import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useJobQuery } from "../../hooks/queries/useJobQuery";
import {
  useDeleteJobMutation,
  useRerunJobMutation,
} from "../../hooks/queries/useJobMutations";
import { JobStatus } from "../job/JobStatus";
import { JobResult } from "../job/JobResult";
import { RerunDialog } from "../job/RerunDialog";

export function JobDetailPage() {
  const { uploadId } = useParams<{ uploadId: string }>();
  const navigate = useNavigate();
  const { data: job, isLoading, error } = useJobQuery(uploadId);
  const deleteMutation = useDeleteJobMutation();
  const rerunMutation = useRerunJobMutation();
  const [rerunOpen, setRerunOpen] = useState(false);

  const handleDelete = () => {
    if (!uploadId) return;
    if (window.confirm("Delete this job? This can't be undone.")) {
      deleteMutation.mutate(uploadId, { onSuccess: () => navigate("/history") });
    }
  };

  const handleRerun = (modelId: string) => {
    if (!uploadId) return;
    rerunMutation.mutate(
      { uploadId, chosenModelId: modelId },
      {
        onSuccess: (newUploadId) => {
          setRerunOpen(false);
          if (newUploadId !== uploadId) navigate(`/jobs/${newUploadId}`);
        },
      },
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        to="/history"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to history
      </Link>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-12 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          <div className="h-40 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
      ) : error || !job ? (
        <div className="p-6 text-center bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl">
          <p className="text-sm text-red-700 dark:text-red-300">
            {error instanceof Error ? error.message : "Job not found."}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
                {job.fileName}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 capitalize mt-0.5">
                {job.kind} job
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setRerunOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Re-run
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>

          <JobStatus status={job.status} />
          <JobResult job={job} />
        </>
      )}

      {rerunOpen && job && (
        <RerunDialog
          kind={job.kind}
          isPending={rerunMutation.isPending}
          onConfirm={handleRerun}
          onClose={() => setRerunOpen(false)}
        />
      )}
    </div>
  );
}
