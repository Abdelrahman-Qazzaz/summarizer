import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteConversation,
  fetchConversations,
  renameConversation,
  type Conversation,
} from "../../api/conversations";
import { errorMessage } from "../../api/http";
import { queryKeys } from "../../lib/queryClient";
import { useToast } from "../toast/useToast";

export function useConversationsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: fetchConversations,
    enabled,
  });
}

export function useRenameConversationMutation() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({
      conversationId,
      title,
    }: {
      conversationId: string;
      title: string;
    }) => renameConversation(conversationId, title),
    onSuccess: (updated) => {
      queryClient.setQueryData<Conversation[]>(
        queryKeys.conversations,
        (current) =>
          current?.map((conversation) =>
            conversation.id === updated.id ? updated : conversation,
          ),
      );
    },
    onError: (error) => {
      toast.show({
        kind: "error",
        message: errorMessage(error, "Couldn't rename that chat."),
      });
    },
  });
}

export function useDeleteConversationMutation() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ conversationId }: { conversationId: string }) =>
      deleteConversation(conversationId),
    onSuccess: (_result, { conversationId }) => {
      queryClient.setQueryData<Conversation[]>(
        queryKeys.conversations,
        (current) =>
          current?.filter((conversation) => conversation.id !== conversationId),
      );
      queryClient.removeQueries({
        queryKey: queryKeys.messages(conversationId),
      });
    },
    onError: (error) => {
      toast.show({
        kind: "error",
        message: errorMessage(error, "Couldn't delete that chat."),
      });
    },
  });
}
