import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchJobs, type JobsListParams } from "../../lib/jobs";
import { queryKeys } from "../../lib/queryClient";

const PAGE_SIZE = 20;

/**
 * Paginated history list. Server-side filtering is used when available; the
 * History page additionally filters the loaded pages client-side as a fallback.
 */
export function useJobsQuery(
  enabled: boolean,
  filters: Pick<JobsListParams, "status" | "kind" | "q"> = {},
) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.jobs, filters],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchJobs({ ...filters, limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
