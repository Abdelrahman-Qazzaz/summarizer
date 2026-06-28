import { useContext, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SocketContext } from "./context";
import { queryKeys } from "../../lib/queryClient";
import { useToast } from "../toast/useToast";
import type { Job } from "../../lib/jobs";

type JobUpdatedPayload = {
  uploadId: string;
};

/**
 * Mounted once (in AppLayout). Listens to every `jobUpdated` socket event,
 * invalidates the affected job + the history list, and surfaces a toast when a
 * job reaches a terminal state.
 */
export function useJobUpdatesBridge(enabled: boolean) {
  const socket = useContext(SocketContext);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!enabled || !socket) return;

    const handler = async ({ uploadId }: JobUpdatedPayload) => {
      if (!uploadId) return;
      await qc.invalidateQueries({ queryKey: queryKeys.job(uploadId) });
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });

      const job = qc.getQueryData<Job>(queryKeys.job(uploadId));
      if (job?.status === "completed") {
        toast.show({
          kind: "success",
          message: `“${job.fileName}” is ready.`,
        });
      } else if (job?.status === "failed") {
        toast.show({
          kind: "error",
          message: `“${job.fileName}” failed${job.error ? `: ${job.error}` : "."}`,
        });
      }
    };

    socket.on("jobUpdated", handler);
    return () => {
      socket.off("jobUpdated", handler);
    };
  }, [enabled, socket, qc, toast]);
}
