import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteJob, rerunJob, type JobKind } from "../../lib/jobs";
import { queryKeys } from "../../lib/queryClient";
import { useToast } from "../toast/useToast";

export function useDeleteJobMutation() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ uploadId, kind }: { uploadId: string; kind: JobKind }) =>
      deleteJob(uploadId, kind),
    onSuccess: (_data, { uploadId }) => {
      qc.removeQueries({ queryKey: queryKeys.job(uploadId) });
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });
      toast.show({ kind: "success", message: "Job deleted." });
    },
    onError: (error) => {
      toast.show({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to delete job.",
      });
    },
  });
}

export function useRerunJobMutation() {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      uploadId,
      kind,
      chosenModelId,
      transcriptionModelId,
    }: {
      uploadId: string;
      kind: JobKind;
      chosenModelId: string;
      transcriptionModelId?: string;
    }) => rerunJob(uploadId, kind, { chosenModelId, transcriptionModelId }),
    onSuccess: (newUploadId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });
      void qc.invalidateQueries({ queryKey: queryKeys.job(newUploadId) });
      toast.show({ kind: "success", message: "Re-run started." });
    },
    onError: (error) => {
      toast.show({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to re-run job.",
      });
    },
  });
}
