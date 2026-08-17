import { conversationMessagesEndpoint } from "../config";
import { apiFetch, apiJson, jsonRequest } from "./http";

export type MessageImage = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

/** A transcript this turn was sent with, in the order it was attached. */
export type MessageTranscript = {
  uploadId: string;
  fileName: string;
  source: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chosenModelId: string | null;
  conversationId: string;
  createdAt: string;
  attachments: MessageImage[];
  transcriptAttachments: MessageTranscript[];
};

export type MessagesResponse = {
  lastMessageId: string | null;
  messages: ChatMessage[];
};

export type SendMessageInput = {
  conversationId: string;
  messageContent: string;
  chosenModelId: string;
  /** Image upload ids, in the order they were staged. */
  attachmentUploadIds: string[];
  /** Transcript upload ids — order decides the order they reach the model. */
  audioUploadIds: string[];
  lastMessageId: string | null;
};

export async function fetchMessages(
  conversationId: string,
): Promise<MessagesResponse> {
  const data = await apiJson<MessagesResponse>(
    conversationMessagesEndpoint(conversationId),
  );
  if (!Array.isArray(data?.messages)) {
    throw new Error("Invalid messages response");
  }
  return data;
}

type StreamCallbacks = {
  onDelta: (delta: string) => void;
  onDone: (lastMessageId: string) => void;
};

function dispatchSseEvent(rawEvent: string, callbacks: StreamCallbacks): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;

  const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  if (eventName === "delta" && typeof data.delta === "string") {
    callbacks.onDelta(data.delta);
  } else if (eventName === "done" && typeof data.lastMessageId === "string") {
    callbacks.onDone(data.lastMessageId);
  } else if (eventName === "error") {
    throw new Error(
      typeof data.message === "string" ? data.message : "Model response failed",
    );
  }
}

/**
 * Sends the turn and reads the reply off the SSE body. EventSource can't POST,
 * so this is fetch + a reader. The run itself is server-side and finishes even
 * if this stream dies — a failure here means "refetch", not "the turn was lost".
 */
export async function streamMessage(
  input: SendMessageInput,
  callbacks: StreamCallbacks,
): Promise<void> {
  const response = await apiFetch(
    conversationMessagesEndpoint(input.conversationId),
    jsonRequest("POST", {
      messageContent: input.messageContent,
      chosenModelId: input.chosenModelId,
      attachmentUploadIds: input.attachmentUploadIds,
      audioUploadIds: input.audioUploadIds,
      lastMessageId: input.lastMessageId,
    }),
  );

  if (!response.body) throw new Error("The response stream was empty");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const dispatch = (rawEvent: string) =>
    dispatchSseEvent(rawEvent, {
      onDelta: callbacks.onDelta,
      onDone: (lastMessageId) => {
        completed = true;
        callbacks.onDone(lastMessageId);
      },
    });

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) dispatch(event);
    if (done) break;
  }

  if (buffer.trim()) dispatch(buffer);
  if (!completed) throw new Error("The response stream ended unexpectedly");
}
