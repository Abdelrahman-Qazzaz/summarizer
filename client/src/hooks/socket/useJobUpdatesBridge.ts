import { useContext, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SocketContext } from "./context";
import { queryKeys } from "../../lib/queryClient";
import { useToast } from "../toast/useToast";
import type { Job } from "../../api/jobs";

type JobUpdatedPayload = {
  audioUploadId: string;
};

/**
 * The fast path for transcript progress: a job update refreshes that job, which
 * is what the staged-source watcher and the sources drawer both read. Only
 * failures are announced — a finished transcript is already visible on its chip.
 */
export function useJobUpdatesBridge(enabled: boolean) {
  const socket = useContext(SocketContext);
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!enabled || !socket) return;

    const handler = async ({ audioUploadId }: JobUpdatedPayload) => {
      if (!audioUploadId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.job(audioUploadId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs });

      const job = queryClient.getQueryData<Job>(queryKeys.job(audioUploadId));
      if (job?.status === "failed") {
        toast.show({
          kind: "error",
          message: `${job.fileName} failed${job.error ? `: ${job.error}` : "."}`,
        });
      }
    };

    // Updates published while the socket was down were delivered to nobody, so
    // reconnecting has to re-read rather than wait for the next push.
    const onReconnect = () => {
      void queryClient.invalidateQueries({ queryKey: ["job"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    };

    socket.on("jobUpdated", handler);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("jobUpdated", handler);
      socket.off("connect", onReconnect);
    };
  }, [enabled, socket, queryClient, toast]);
}
