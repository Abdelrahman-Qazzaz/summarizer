import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** Centralized query keys so the socket bridge and mutations stay in sync. */
export const queryKeys = {
  models: ["models"] as const,
  jobs: ["jobs"] as const,
  job: (uploadId: string) => ["job", uploadId] as const,
};
