import type { JobStatus as JobStatusType } from "../../lib/jobs";

type JobStatusProps = {
  status: JobStatusType;
  message?: string | null;
  loading?: boolean;
};

const statusConfig: Record<
  JobStatusType,
  { label: string; color: string; bgColor: string }
> = {
  queued: {
    label: "Queued",
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-900/40",
  },
  processing: {
    label: "Processing",
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-100 dark:bg-blue-900/40",
  },
  completed: {
    label: "Completed",
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-100 dark:bg-green-900/40",
  },
  failed: {
    label: "Failed",
    color: "text-red-700 dark:text-red-300",
    bgColor: "bg-red-100 dark:bg-red-900/40",
  },
};

function PulsingDot({ color }: { color: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

export function JobStatus({ status, message, loading }: JobStatusProps) {
  const config = statusConfig[status];
  const isActive = status === "queued" || status === "processing";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${config.bgColor}`}>
      {isActive || loading ? (
        <PulsingDot color={status === "processing" ? "bg-blue-500" : "bg-amber-500"} />
      ) : (
        <span className={`w-2.5 h-2.5 rounded-full ${
          status === "completed" ? "bg-green-500" : "bg-red-500"
        }`} />
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${config.color}`}>
          {config.label}
        </p>
        {message && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
            {message}
          </p>
        )}
      </div>

      {isActive && (
        <svg className="animate-spin h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
    </div>
  );
}
