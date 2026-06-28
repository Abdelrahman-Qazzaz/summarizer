import { useState } from "react";
import type { Job } from "../../lib/jobs";
import { downloadTextFile, resultFileName } from "../../lib/download";

type JobResultProps = {
  job: Job;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error("Failed to copy text");
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
        text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg
        hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function DownloadButton({ filename, content }: { filename: string; content: string }) {
  return (
    <button
      onClick={() => downloadTextFile(filename, content)}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
        text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg
        hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download
    </button>
  );
}

function ResultSection({
  title,
  content,
  downloadName,
}: {
  title: string;
  content: string;
  downloadName: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="flex items-center gap-2">
          <CopyButton text={content} />
          <DownloadButton filename={downloadName} content={content} />
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl">
      <p className="text-sm text-gray-600 dark:text-gray-400">No {label} available yet.</p>
    </div>
  );
}

export function JobResult({ job }: JobResultProps) {
  if (job.status === "failed") {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">
              Processing Failed
            </h3>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
              {job.error || "An unexpected error occurred. Please try again."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (job.status !== "completed") {
    return null;
  }

  if (job.kind === "text") {
    return job.summary ? (
      <ResultSection
        title="Summary"
        content={job.summary}
        downloadName={resultFileName(job.fileName, "summary")}
      />
    ) : (
      <EmptySection label="summary" />
    );
  }

  // Audio: show summary (if the downstream summarize step produced one) + transcript.
  return (
    <div className="space-y-4">
      {job.summary ? (
        <ResultSection
          title="Summary"
          content={job.summary}
          downloadName={resultFileName(job.fileName, "summary")}
        />
      ) : (
        <EmptySection label="summary" />
      )}
      {job.transcript ? (
        <ResultSection
          title="Transcript"
          content={job.transcript}
          downloadName={resultFileName(job.fileName, "transcript")}
        />
      ) : (
        <EmptySection label="transcript" />
      )}
    </div>
  );
}
