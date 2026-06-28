import { useQuery } from "@tanstack/react-query";
import { fetchJob } from "../../lib/jobs";
import { queryKeys } from "../../lib/queryClient";

/** Fetches a single job by upload id. Disabled when no id is provided. */
export function useJobQuery(uploadId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.job(uploadId ?? ""),
    queryFn: () => fetchJob(uploadId as string),
    enabled: !!uploadId,
  });
}
