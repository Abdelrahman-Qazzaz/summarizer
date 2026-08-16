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
  chatModels: ["models", "chat"] as const,
  transcriptionModels: ["models", "transcription"] as const,
  jobs: ["jobs"] as const,
  job: (uploadId: string) => ["job", uploadId] as const,
  conversations: ["conversations"] as const,
  messages: (conversationId: string) =>
    ["conversations", conversationId, "messages"] as const,
};
