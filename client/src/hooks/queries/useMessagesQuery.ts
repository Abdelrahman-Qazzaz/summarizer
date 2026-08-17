import { useQuery } from "@tanstack/react-query";
import { fetchMessages } from "../../api/messages";
import { queryKeys } from "../../lib/queryClient";

export function useMessagesQuery(conversationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messages(conversationId ?? ""),
    queryFn: () => fetchMessages(conversationId as string),
    enabled: !!conversationId,
  });
}
