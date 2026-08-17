import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../hooks/auth/useAuth";
import { useJobQuery } from "../../hooks/queries/useJobQuery";
import {
  useConversationsQuery,
  useMessagesQuery,
} from "../../hooks/queries/useChatQueries";
import { useChatModelsQuery } from "../../hooks/queries/useModelsQuery";
import { useToast } from "../../hooks/toast/useToast";
import {
  ChatRequestError,
  createConversation,
  streamConversationMessage,
  uploadChatImage,
  type MessageAttachment,
} from "../../lib/chat";
import {
  canChatWithImages,
  canChatWithText,
  DEFAULT_TEXT_MODEL,
  resolveDefaultModel,
} from "../../lib/modelFilters";
import { queryKeys } from "../../lib/queryClient";
import { ChatComposer } from "../chat/ChatComposer";
import { ChatMessageList } from "../chat/ChatMessageList";
import { ConversationSidebar } from "../chat/ConversationSidebar";
import type { PendingTurn, StagedImage } from "../chat/types";

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function conversationTitle(messageContent: string): string {
  return messageContent.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const conversationsQuery = useConversationsQuery(!!user);
  const messagesQuery = useMessagesQuery(conversationId);
  const chatModels = useChatModelsQuery(!!user);
  const audioUploadId = searchParams.get("audioUploadId");
  const transcriptJobQuery = useJobQuery(audioUploadId);

  const [messageContent, setMessageContent] = useState("");
  const [modelPick, setModelPick] = useState<string | null>(null);
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const stagedImagesRef = useRef<StagedImage[]>([]);
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    stagedImagesRef.current = stagedImages;
  }, [stagedImages]);

  useEffect(
    () => () => {
      for (const image of stagedImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    },
    [],
  );

  const modelEntries = useMemo(
    () =>
      chatModels.entries.filter(([, modelInfo]) =>
        stagedImages.length > 0
          ? canChatWithImages(modelInfo)
          : canChatWithText(modelInfo),
      ),
    [chatModels.entries, stagedImages.length],
  );
  const selectedModelId =
    modelPick && modelEntries.some(([modelId]) => modelId === modelPick)
      ? modelPick
      : resolveDefaultModel(
          modelEntries.map(([modelId]) => modelId),
          DEFAULT_TEXT_MODEL,
        );
  const modelOptions = modelEntries.map(([modelId, modelInfo]) => ({
    id: modelId,
    label: modelInfo.name || modelId,
    info: modelInfo,
  }));

  const transcriptReady =
    !!audioUploadId &&
    transcriptJobQuery.data?.status === "completed" &&
    !!transcriptJobQuery.data.transcript;
  const transcriptAttachment = audioUploadId
    ? {
        fileName: transcriptJobQuery.data?.fileName ?? "Transcript",
        state: transcriptJobQuery.isLoading
          ? ("loading" as const)
          : transcriptReady
            ? ("ready" as const)
            : ("error" as const),
      }
    : null;

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const availableSlots = MAX_IMAGES - stagedImages.length;
    const selectedFiles = Array.from(files).slice(0, availableSlots);
    if (files.length > availableSlots) {
      toast.show({ kind: "error", message: "You can attach up to 6 images." });
    }

    const accepted: StagedImage[] = [];
    for (const file of selectedFiles) {
      if (!file.type.startsWith("image/")) {
        toast.show({
          kind: "error",
          message: `“${file.name}” is not an image.`,
        });
      } else if (file.size > MAX_IMAGE_BYTES) {
        toast.show({
          kind: "error",
          message: `“${file.name}” is larger than 10 MB.`,
        });
      } else {
        accepted.push({
          localId: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          uploaded: null,
        });
      }
    }
    setStagedImages((current) => [...current, ...accepted]);
  };

  const removeImage = (localId: string) => {
    setStagedImages((current) => {
      const removed = current.find((image) => image.localId === localId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.localId !== localId);
    });
  };

  const removeTranscript = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("audioUploadId");
    setSearchParams(nextParams, { replace: true });
  };

  const uploadImages = async (
    images: StagedImage[],
  ): Promise<MessageAttachment[]> =>
    Promise.all(
      images.map(async (image) => {
        if (image.uploaded) return image.uploaded;
        const uploaded = await uploadChatImage(image.file);
        setStagedImages((current) =>
          current.map((candidate) =>
            candidate.localId === image.localId
              ? { ...candidate, uploaded }
              : candidate,
          ),
        );
        return uploaded;
      }),
    );

  const sendMessage = async () => {
    const trimmedMessage = messageContent.trim();
    if (!trimmedMessage || !selectedModelId || sending) return;

    setSending(true);
    const imagesToSend = stagedImages;
    let targetConversationId = conversationId;

    try {
      if (!targetConversationId) {
        const created = await createConversation(
          conversationTitle(trimmedMessage),
        );
        targetConversationId = created.id;
        queryClient.setQueryData(
          queryKeys.conversations,
          (current: typeof conversationsQuery.data) => [
            created,
            ...(current ?? []).filter(
              (conversation) => conversation.id !== created.id,
            ),
          ],
        );
        const transcriptQuery = audioUploadId
          ? `?audioUploadId=${encodeURIComponent(audioUploadId)}`
          : "";
        navigate(`/chat/${created.id}${transcriptQuery}`, { replace: true });
      }

      const attachments = await uploadImages(imagesToSend);
      setPendingTurn({
        content: trimmedMessage,
        attachments,
        audioFileName: transcriptReady
          ? (transcriptJobQuery.data?.fileName ?? "Transcript")
          : null,
        assistantContent: "",
      });

      await streamConversationMessage(
        {
          conversationId: targetConversationId,
          messageContent: trimmedMessage,
          chosenModelId: selectedModelId,
          attachmentUploadIds: attachments.map(
            (attachment) => attachment.uploadId,
          ),
          ...(transcriptReady && audioUploadId ? { audioUploadId } : {}),
          lastMessageId: conversationId
            ? (messagesQuery.data?.lastMessageId ?? null)
            : null,
        },
        {
          onDelta: (delta) =>
            setPendingTurn((current) =>
              current
                ? {
                    ...current,
                    assistantContent: current.assistantContent + delta,
                  }
                : current,
            ),
          onDone: () => undefined,
        },
      );

      setMessageContent("");
      for (const image of imagesToSend) URL.revokeObjectURL(image.previewUrl);
      setStagedImages([]);
      setPendingTurn(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.messages(targetConversationId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
      ]);
      navigate(`/chat/${targetConversationId}`, { replace: true });
    } catch (error) {
      setPendingTurn(null);
      if (targetConversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.messages(targetConversationId),
        });
      }
      toast.show({
        kind: "error",
        message:
          error instanceof ChatRequestError && error.status === 409
            ? "This conversation changed. Its latest messages were reloaded; try again."
            : error instanceof Error
              ? error.message
              : "Failed to send message.",
      });
    } finally {
      setSending(false);
    }
  };

  const existingConversationReady =
    !conversationId || (!!messagesQuery.data && !messagesQuery.error);
  const transcriptSelectionReady = !audioUploadId || transcriptReady;
  const canSend =
    !!messageContent.trim() &&
    !!selectedModelId &&
    !sending &&
    existingConversationReady &&
    transcriptSelectionReady;

  return (
    <div className="flex flex-col md:flex-row gap-4 max-w-6xl mx-auto md:h-[calc(100vh-10rem)]">
      <ConversationSidebar
        conversations={conversationsQuery.data ?? []}
        activeConversationId={conversationId}
        loading={conversationsQuery.isLoading}
      />

      <section className="flex-1 min-w-0 min-h-[38rem] md:min-h-0 flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        {messagesQuery.error ? (
          <div className="flex-1 flex items-center justify-center p-6 text-sm text-red-700 dark:text-red-300">
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "Failed to load conversation."}
          </div>
        ) : (
          <ChatMessageList
            messages={messagesQuery.data?.messages ?? []}
            pendingTurn={pendingTurn}
            loading={!!conversationId && messagesQuery.isLoading}
          />
        )}
        <ChatComposer
          messageContent={messageContent}
          onMessageChange={setMessageContent}
          stagedImages={stagedImages}
          onAddImages={addImages}
          onRemoveImage={removeImage}
          transcriptAttachment={transcriptAttachment}
          onRemoveTranscript={removeTranscript}
          modelOptions={modelOptions}
          selectedModelId={selectedModelId}
          onModelChange={setModelPick}
          modelsLoading={chatModels.loading}
          modelsError={chatModels.error}
          sending={sending}
          canSend={canSend}
          onSend={() => void sendMessage()}
        />
      </section>
    </div>
  );
}
