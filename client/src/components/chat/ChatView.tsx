import { useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CHARS_PER_TOKEN,
  DEFAULT_TEXT_MODEL,
  meetsRequirements,
  resolveDefaultModel,
  type MessageRequirements,
} from "../../api/models";
import { useAuth } from "../../hooks/auth/useAuth";
import { useChatModelsQuery } from "../../hooks/queries/useModelsQuery";
import { MAX_CONTEXT_MESSAGES } from "../../api/messages";
import { useMessagesQuery } from "../../hooks/queries/useMessagesQuery";
import { isSourceInFlight, type StagedSource } from "../../sources/types";
import { useSources } from "../../sources/useSources";
import { Composer } from "../composer/Composer";
import { DropOverlay } from "../composer/DropOverlay";
import { MessageList } from "./MessageList";
import { useChatSend } from "./useChatSend";

const NEW_CHAT_KEY = "new";

function blockedReasonFor(sources: StagedSource[]): string | null {
  const failed = sources.find((source) => source.status === "failed");
  if (failed) return `${failed.name} didn't upload. Retry or remove it to send.`;

  const waiting = sources.find(isSourceInFlight);
  if (!waiting) return null;
  if (waiting.status === "preparing") return `Preparing ${waiting.name}…`;
  if (waiting.status === "uploading") return `Uploading ${waiting.name}…`;
  return `Transcribing ${waiting.name} — send unlocks when it lands.`;
}

export function ChatView() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const draftKey = conversationId ?? NEW_CHAT_KEY;

  // Drafts are per chat: switching away and back keeps what you were writing,
  // and the sources already uploading against it.
  const [texts, setTexts] = useState<Record<string, string>>({});
  const text = texts[draftKey] ?? "";
  const setText = (value: string) =>
    setTexts((current) => ({ ...current, [draftKey]: value }));

  const { sources, takeSources, restoreSourcesFor, addFiles } =
    useSources(draftKey);
  const messagesQuery = useMessagesQuery(conversationId);
  const chatModels = useChatModelsQuery(!!user);
  const [modelPick, setModelPick] = useState<string | null>(null);
  const { pendingTurns, sendingKeys, send } = useChatSend();

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const history = messagesQuery.data?.messages;

  /**
   * What the next turn will demand of a model. This is the whole prompt, not
   * just the message being written: the server replays the conversation's
   * recent history, so an image three turns back still makes the request an
   * image request, and the replayed text still has to fit the context window.
   * The API rejects a model that can't serve the assembled context, so the
   * picker hides those rather than letting the send fail.
   */
  const requirements: MessageRequirements = useMemo(() => {
    // Only the window the server actually replays counts.
    const replayed = (history ?? []).slice(-MAX_CONTEXT_MESSAGES);
    const historyChars = replayed.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    const stagedChars = sources.reduce(
      (total, source) =>
        source.kind === "image" ? total : total + (source.charCount ?? 0),
      0,
    );
    // Deliberately not capped at the server's truncation ceiling: a model that
    // only fits because history would be dropped is not a model that can answer
    // this conversation. Once something disqualifies a model it stays
    // disqualified, which makes the list predictable.
    const chars = historyChars + stagedChars + text.length;
    return {
      image:
        sources.some((source) => source.kind === "image") ||
        replayed.some((message) => message.attachments.length > 0),
      tokens: Math.ceil(chars / CHARS_PER_TOKEN),
    };
  }, [history, sources, text]);

  const models = useMemo(
    () => chatModels.entries.map(([modelId, info]) => ({ id: modelId, info })),
    [chatModels.entries],
  );

  // Requirements narrow the list, so a pick made earlier can fall out of it.
  const eligibleIds = useMemo(
    () =>
      models
        .filter((model) => meetsRequirements(model.info, requirements))
        .map((model) => model.id),
    [models, requirements],
  );
  const modelId =
    modelPick && eligibleIds.includes(modelPick)
      ? modelPick
      : resolveDefaultModel(eligibleIds, DEFAULT_TEXT_MODEL);

  const sending = !!sendingKeys[draftKey];
  const blockedReason = blockedReasonFor(sources);
  const historyReady =
    !conversationId || (!!messagesQuery.data && !messagesQuery.error);
  const canSend =
    !!text.trim() && !!modelId && !sending && !blockedReason && historyReady;

  const handleSend = () => {
    if (!canSend || !modelId) return;
    const content = text.trim();
    const staged = takeSources();
    setText("");

    void send({
      conversationId,
      content,
      modelId,
      sources: staged,
      lastMessageId: conversationId
        ? (messagesQuery.data?.lastMessageId ?? null)
        : null,
      onConversation: (createdId) =>
        navigate(`/chat/${createdId}`, { replace: true }),
      onRestore: (restoredContent, restoredSources, restoreKey) => {
        setTexts((current) => ({ ...current, [restoreKey]: restoredContent }));
        restoreSourcesFor(restoreKey, restoredSources);
      },
    });
  };

  const handleDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <main
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {messagesQuery.error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <p className="text-sm text-live">
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "This chat couldn't be loaded."}
          </p>
        </div>
      ) : (
        <MessageList
          messages={messagesQuery.data?.messages ?? []}
          pending={conversationId ? (pendingTurns[conversationId] ?? null) : null}
          loading={!!conversationId && messagesQuery.isLoading}
        />
      )}

      <Composer
        draftKey={draftKey}
        text={text}
        onTextChange={setText}
        models={models}
        modelId={modelId}
        onModelChange={setModelPick}
        modelsLoading={chatModels.loading}
        modelsError={chatModels.error}
        requirements={requirements}
        sending={sending}
        canSend={canSend}
        blockedReason={blockedReason}
        onSend={handleSend}
      />

      {dragging && <DropOverlay />}
    </main>
  );
}
