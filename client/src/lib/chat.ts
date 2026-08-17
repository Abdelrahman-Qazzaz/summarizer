import {
  conversationMessagesEndpoint,
  conversationsEndpoint,
  uploadImageEndpoint,
} from "../config";

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageAttachment = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chosenModelId: string | null;
  conversationId: string;
  audioUploadId: string | null;
  createdAt: string;
  attachments: MessageAttachment[];
};

export type MessagesResponse = {
  lastMessageId: string | null;
  messages: ChatMessage[];
};

export type SendMessageInput = {
  conversationId: string;
  messageContent: string;
  chosenModelId: string;
  attachmentUploadIds: string[];
  audioUploadIds: string[];
  lastMessageId: string | null;
};

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function responseData(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function responseMessage(data: unknown, response: Response): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return response.statusText || `Request failed (${response.status})`;
}

async function expectJson<T>(response: Response): Promise<T> {
  const data = await responseData(response);
  if (!response.ok) {
    throw new ChatRequestError(
      responseMessage(data, response),
      response.status,
    );
  }
  return data as T;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const response = await fetch(conversationsEndpoint(), {
    credentials: "include",
  });
  const data = await expectJson<{ conversations: Conversation[] }>(response);
  if (!Array.isArray(data?.conversations)) {
    throw new Error("Invalid conversations response");
  }
  return data.conversations;
}

export async function createConversation(title: string): Promise<Conversation> {
  const response = await fetch(conversationsEndpoint(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationTitle: title }),
  });
  return expectJson<Conversation>(response);
}

export async function fetchMessages(
  conversationId: string,
): Promise<MessagesResponse> {
  const response = await fetch(conversationMessagesEndpoint(conversationId), {
    credentials: "include",
  });
  const data = await expectJson<MessagesResponse>(response);
  if (!Array.isArray(data?.messages)) {
    throw new Error("Invalid messages response");
  }
  return data;
}

export async function uploadChatImage(file: File): Promise<MessageAttachment> {
  const body = new FormData();
  body.append("uploadFile", file);
  const response = await fetch(uploadImageEndpoint(), {
    method: "POST",
    credentials: "include",
    body,
  });
  const data = await expectJson<{
    uploadId: string;
    fileName: string;
    mimeType: string;
    size: number;
    signedUrl: string;
  }>(response);
  return {
    uploadId: data.uploadId,
    fileName: data.fileName,
    mimeType: data.mimeType,
    size: data.size,
    url: data.signedUrl,
  };
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

export async function streamConversationMessage(
  input: SendMessageInput,
  callbacks: StreamCallbacks,
): Promise<void> {
  const response = await fetch(
    conversationMessagesEndpoint(input.conversationId),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageContent: input.messageContent,
        chosenModelId: input.chosenModelId,
        attachmentUploadIds: input.attachmentUploadIds,
        audioUploadIds: input.audioUploadIds,
        lastMessageId: input.lastMessageId,
      }),
    },
  );

  if (!response.ok) {
    const data = await responseData(response);
    throw new ChatRequestError(
      responseMessage(data, response),
      response.status,
    );
  }
  if (!response.body) throw new Error("The response stream was empty");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      dispatchSseEvent(event, {
        onDelta: callbacks.onDelta,
        onDone: (lastMessageId) => {
          completed = true;
          callbacks.onDone(lastMessageId);
        },
      });
    }
    if (done) break;
  }

  if (buffer.trim()) {
    dispatchSseEvent(buffer, {
      onDelta: callbacks.onDelta,
      onDone: (lastMessageId) => {
        completed = true;
        callbacks.onDone(lastMessageId);
      },
    });
  }
  if (!completed) throw new Error("The response stream ended unexpectedly");
}
