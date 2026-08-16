import { useQuery } from "@tanstack/react-query";
import { fetchConversations, fetchMessages } from "../../lib/chat";
import { queryKeys } from "../../lib/queryClient";

export function useConversationsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: fetchConversations,
    enabled,
  });
}

export function useMessagesQuery(conversationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messages(conversationId ?? ""),
    queryFn: () => fetchMessages(conversationId as string),
    enabled: !!conversationId,
  });
}
