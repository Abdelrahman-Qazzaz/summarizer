import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createConversation, type Conversation } from "../../api/conversations";
import { ApiError, errorMessage } from "../../api/http";
import {
  streamMessage,
  type ChatMessage,
  type MessagesResponse,
} from "../../api/messages";
import { queryKeys } from "../../lib/queryClient";
import { useToast } from "../../hooks/toast/useToast";
import type { StagedSource } from "../../sources/types";
import type { PendingTurn } from "./types";

/** Deltas arrive faster than a long reply can be re-parsed; batch them. */
const FLUSH_INTERVAL_MS = 80;

const uploadIdsOf = (sources: StagedSource[], images: boolean) =>
  sources
    .filter((source) => (source.kind === "image") === images)
    .map((source) => source.uploadId)
    .filter((uploadId): uploadId is string => uploadId !== null);

/**
 * The turn as it will be stored, built from what the client already has: the
 * text it sent, the sources it staged, and the reply it just streamed. Writing
 * this into the cache is what saves re-downloading the whole conversation
 * after every message.
 *
 * The user message gets a local id because the server only returns the
 * assistant's. The query is marked stale straight after, so the next fetch
 * replaces both with the stored rows.
 */
function toStoredTurns(
  input: { content: string; modelId: string; sources: StagedSource[] },
  conversationId: string,
  assistantId: string,
  assistantContent: string,
): ChatMessage[] {
  const createdAt = new Date().toISOString();
  const user: ChatMessage = {
    id: `local:${crypto.randomUUID()}`,
    role: "user",
    content: input.content,
    chosenModelId: null,
    conversationId,
    createdAt,
    attachments: input.sources
      .filter((source) => source.kind === "image" && source.uploadId)
      .map((source) => ({
        uploadId: source.uploadId as string,
        fileName: source.name,
        mimeType: source.file?.type ?? "",
        size: source.file?.size ?? 0,
        url: source.previewUrl ?? "",
      })),
    transcriptAttachments: input.sources
      .filter((source) => source.kind !== "image" && source.uploadId)
      .map((source) => ({
        uploadId: source.uploadId as string,
        fileName: source.name,
        // The generated title is a server-side field; null falls back to the
        // file name, which is the label the composer chip was already showing.
        title: null,
        source: source.kind,
      })),
  };
  const assistant: ChatMessage = {
    id: assistantId,
    role: "assistant",
    content: assistantContent,
    chosenModelId: input.modelId,
    conversationId,
    createdAt,
    attachments: [],
    transcriptAttachments: [],
  };
  return [user, assistant];
}

function toPendingTurn(content: string, sources: StagedSource[]): PendingTurn {
  return {
    content,
    images: sources
      .filter((source) => source.kind === "image")
      .map((source) => ({
        uploadId: source.uploadId ?? source.localId,
        fileName: source.name,
        url: source.previewUrl ?? "",
      })),
    transcripts: sources
      .filter((source) => source.kind !== "image")
      .map((source) => ({
        uploadId: source.uploadId ?? source.localId,
        fileName: source.name,
        title: null,
        source: source.kind,
      })),
    assistantContent: "",
  };
}

type SendInput = {
  conversationId: string | undefined;
  content: string;
  modelId: string;
  sources: StagedSource[];
  lastMessageId: string | null;
  /** Called once the conversation exists, before the reply starts. */
  onConversation: (conversationId: string) => void;
  /** Puts the message back in the composer when the send didn't take. */
  onRestore: (
    content: string,
    sources: StagedSource[],
    draftKey: string,
  ) => void;
};

/**
 * Owns the turns that are mid-flight. Keyed by conversation so a reply streaming
 * in one chat keeps streaming while you read or write in another.
 */
export function useChatSend() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingTurns, setPendingTurns] = useState<Record<string, PendingTurn>>(
    {},
  );
  const [sendingKeys, setSendingKeys] = useState<Record<string, boolean>>({});

  const dropPending = useCallback((conversationId: string) => {
    setPendingTurns((current) => {
      if (!(conversationId in current)) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const send = useCallback(
    async (input: SendInput) => {
      let conversationId = input.conversationId;
      const startedKey = conversationId ?? "new";
      setSendingKeys((current) => ({ ...current, [startedKey]: true }));

      try {
        if (!conversationId) {
          const created = await createConversation();
          const createdId = created.id;
          conversationId = createdId;
          queryClient.setQueryData<Conversation[]>(
            queryKeys.conversations,
            (current) => [
              created,
              ...(current ?? []).filter(
                (conversation) => conversation.id !== createdId,
              ),
            ],
          );
          setSendingKeys((current) => ({ ...current, [createdId]: true }));
          input.onConversation(createdId);
        }

        const target = conversationId;
        setPendingTurns((current) => ({
          ...current,
          [target]: toPendingTurn(input.content, input.sources),
        }));

        let buffered = "";
        let storedAssistantId: string | null = null;
        let flushTimer: number | null = null;
        const flush = () => {
          flushTimer = null;
          setPendingTurns((current) => {
            const turn = current[target];
            if (!turn) return current;
            return {
              ...current,
              [target]: { ...turn, assistantContent: buffered },
            };
          });
        };

        try {
          await streamMessage(
            {
              conversationId: target,
              messageContent: input.content,
              chosenModelId: input.modelId,
              attachmentUploadIds: uploadIdsOf(input.sources, true),
              audioUploadIds: uploadIdsOf(input.sources, false),
              lastMessageId: input.lastMessageId,
            },
            {
              onDelta: (delta) => {
                buffered += delta;
                if (flushTimer === null) {
                  flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS);
                }
              },
              onDone: (lastMessageId) => {
                storedAssistantId = lastMessageId;
              },
            },
          );
        } finally {
          if (flushTimer !== null) window.clearTimeout(flushTimer);
        }

        // Write the finished turn into the cache rather than refetching the
        // conversation: the whole history came down the wire after every
        // message, and it only grows. Cancel first so an in-flight fetch can't
        // land on top of this.
        await queryClient.cancelQueries({
          queryKey: queryKeys.messages(target),
        });
        queryClient.setQueryData<MessagesResponse>(
          queryKeys.messages(target),
          (current) => ({
            lastMessageId: storedAssistantId ?? current?.lastMessageId ?? null,
            messages: [
              ...(current?.messages ?? []),
              ...toStoredTurns(
                input,
                target,
                storedAssistantId ?? `local:${crypto.randomUUID()}`,
                buffered,
              ),
            ],
          }),
        );
        dropPending(target);
        // Stale, but not refetched now: the next mount reconciles the local
        // user-message id against the stored one at no cost here.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.messages(target),
          refetchType: "none",
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.conversations,
        });
      } catch (error) {
        if (conversationId) {
          dropPending(conversationId);
          // The run outlives this stream server-side; a refetch is how a reply
          // that finished anyway still reaches the screen.
          void queryClient.invalidateQueries({
            queryKey: queryKeys.messages(conversationId),
          });
        }
        input.onRestore(input.content, input.sources, conversationId ?? "new");
        toast.show({
          kind: "error",
          message:
            error instanceof ApiError && error.status === 409
              ? "This chat moved on. Its latest messages were reloaded — try again."
              : errorMessage(error, "The message didn't send."),
        });
      } finally {
        const finishedKey = conversationId;
        setSendingKeys((current) => {
          const next = { ...current };
          delete next[startedKey];
          if (finishedKey) delete next[finishedKey];
          return next;
        });
      }
    },
    [dropPending, queryClient, toast],
  );

  return { pendingTurns, sendingKeys, send };
}
