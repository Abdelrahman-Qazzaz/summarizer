import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteJob,
  fetchJob,
  fetchJobs,
  rerunJob,
  type JobsFilters,
} from "../../api/jobs";
import { errorMessage } from "../../api/http";
import { queryKeys } from "../../lib/queryClient";
import { useToast } from "../toast/useToast";

const PAGE_SIZE = 20;

/** The sources library — every transcript job the user owns, newest first. */
export function useJobsQuery(enabled: boolean, filters: JobsFilters = {}) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.jobs, filters],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchJobs({ ...filters, limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** One job with its transcript body — what the transcript view reads. */
export function useJobQuery(uploadId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(uploadId ?? ""),
    queryFn: () => fetchJob(uploadId as string),
    enabled: !!uploadId,
  });
}

export function useDeleteJobMutation() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ uploadId }: { uploadId: string }) => deleteJob(uploadId),
    onSuccess: (_result, { uploadId }) => {
      queryClient.removeQueries({ queryKey: queryKeys.job(uploadId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
      toast.show({ kind: "success", message: "Source deleted." });
    },
    onError: (error) => {
      toast.show({
        kind: "error",
        message: errorMessage(error, "Couldn't delete that source."),
      });
    },
  });
}

export function useRerunJobMutation() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      uploadId,
      transcriptModelId,
    }: {
      uploadId: string;
      transcriptModelId: string;
    }) => rerunJob(uploadId, transcriptModelId),
    onSuccess: (uploadId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.job(uploadId) });
      toast.show({ kind: "success", message: "Transcribing again." });
    },
    onError: (error) => {
      toast.show({
        kind: "error",
        message: errorMessage(error, "Couldn't start that re-run."),
      });
    },
  });
}
