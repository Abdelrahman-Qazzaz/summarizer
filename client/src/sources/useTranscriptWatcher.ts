import { useEffect, useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchJob, type Job } from "../api/jobs";
import { useSocketConnected } from "../hooks/socket/useSocketConnected";
import { queryKeys } from "../lib/queryClient";
import type { StagedSource } from "./types";

/**
 * Only used while the socket is down. /jobs allows 100 requests per 15 minutes
 * per user, shared with the sources drawer, so this stays slow on purpose —
 * push is the real mechanism and a reconnect refetches everything anyway.
 */
const OFFLINE_POLL_MS = 20_000;

/**
 * Watches every staged source waiting on a transcript and moves it to ready or
 * failed. Nothing else advances a source past `transcribing`: the upload
 * response only tells us the job was queued.
 */
export function useTranscriptWatcher(
  drafts: Record<string, StagedSource[]>,
  patchByUploadId: (uploadId: string, patch: Partial<StagedSource>) => void,
) {
  const socketConnected = useSocketConnected();

  const pendingUploadIds = useMemo(() => {
    const uploadIds = new Set<string>();
    for (const draft of Object.values(drafts)) {
      for (const source of draft) {
        if (source.status === "transcribing" && source.uploadId) {
          uploadIds.add(source.uploadId);
        }
      }
    }
    return [...uploadIds].sort();
  }, [drafts]);

  const results = useQueries({
    queries: pendingUploadIds.map((uploadId) => ({
      queryKey: queryKeys.job(uploadId),
      queryFn: () => fetchJob(uploadId),
      refetchInterval: socketConnected ? (false as const) : OFFLINE_POLL_MS,
      staleTime: 0,
    })),
  });

  const settled = results.flatMap((result) =>
    result.data?.status === "completed" || result.data?.status === "failed"
      ? [result.data]
      : [],
  );
  // The patch effect keys off what actually changed, not the array identity
  // useQueries hands back on every render.
  const signature = settled
    .map((job) => `${job.uploadId}:${job.status}`)
    .join("|");
  const settledRef = useRef<Job[]>(settled);
  useEffect(() => {
    settledRef.current = settled;
  });

  useEffect(() => {
    for (const job of settledRef.current) {
      if (job.status === "completed") {
        patchByUploadId(job.uploadId, {
          status: "ready",
          name: job.fileName,
          charCount: job.transcript?.length ?? null,
        });
      } else {
        patchByUploadId(job.uploadId, {
          status: "failed",
          error: job.error ?? "Transcription failed.",
        });
      }
    }
  }, [signature, patchByUploadId]);
}
