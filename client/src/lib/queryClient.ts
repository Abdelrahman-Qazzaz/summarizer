import { QueryClient, type Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

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
  chatModels: ["models", "chat"] as const,
  transcriptionModels: ["models", "transcription"] as const,
  jobs: ["jobs"] as const,
  job: (audioUploadId: string) => ["job", audioUploadId] as const,
  conversations: ["conversations"] as const,
  messages: (conversationId: string) =>
    ["conversations", conversationId, "messages"] as const,
};

/**
 * Only what is worth having on disk: the model catalogs, which are large and
 * change about daily, and the conversation list, which paints the sidebar.
 *
 * Messages are deliberately excluded — they are the bulk of the cache, they go
 * stale the moment anyone sends, and they are cheap to refetch for the one
 * conversation actually being read.
 */
function shouldPersist(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const [root, second] = query.queryKey as string[];
  if (root === "models") return true;
  // queryKeys.messages() also starts with "conversations", so the list is
  // matched by its exact single-segment key rather than by prefix.
  return root === "conversations" && second === undefined;
}

/**
 * Reading localStorage can throw outright when storage is blocked (private
 * browsing, cookies disabled). The persister no-ops on undefined, so failing
 * to cache costs a round trip rather than the whole app.
 */
function availableStorage(): Storage | undefined {
  try {
    const probe = "__summarizer_probe__";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const persistOptions = {
  persister: createSyncStoragePersister({
    storage: availableStorage(),
    key: "summarizer-query-cache",
  }),
  maxAge: 24 * 60 * 60 * 1000,
  // Bump when a cached shape changes, to drop entries written by an older build.
  buster: "v1",
  dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
};
