import { useEffect, useRef } from "react";
import type { ChatMessage, MessageAttachment } from "../../lib/chat";
import type { PendingTurn } from "./types";

function AttachmentGrid({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
      {attachments.map((attachment) => (
        <a
          key={attachment.uploadId}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
        >
          <img
            src={attachment.url}
            alt={attachment.fileName}
            className="w-full h-28 object-cover"
          />
        </a>
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] sm:max-w-[78%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary-600 text-white"
            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        }`}
      >
        <AttachmentGrid attachments={message.attachments} />
        {message.audioUploadId && (
          <p
            className={`mb-2 text-xs font-medium ${
              isUser
                ? "text-primary-100"
                : "text-primary-600 dark:text-primary-300"
            }`}
          >
            Transcript attached
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap leading-relaxed">
          {message.content}
        </p>
      </div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  pendingTurn,
  loading,
}: {
  messages: ChatMessage[];
  pendingTurn: PendingTurn | null;
  loading: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pendingTurn?.assistantContent]);

  if (loading) {
    return (
      <div className="flex-1 space-y-3 p-4">
        <div className="h-16 w-2/3 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-20 w-3/4 ml-auto rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  if (messages.length === 0 && !pendingTurn) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Start a chat
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Ask a question, add images, or bring in a completed transcript.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {pendingTurn && (
        <>
          <div className="flex justify-end">
            <div className="max-w-[88%] sm:max-w-[78%] rounded-2xl px-4 py-3 bg-primary-600 text-white">
              <AttachmentGrid attachments={pendingTurn.attachments} />
              {pendingTurn.audioFileName && (
                <p className="mb-2 text-xs font-medium text-primary-100">
                  Transcript: {pendingTurn.audioFileName}
                </p>
              )}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {pendingTurn.content}
              </p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[88%] sm:max-w-[78%] rounded-2xl px-4 py-3 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
              {pendingTurn.assistantContent ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {pendingTurn.assistantContent}
                </p>
              ) : (
                <span className="inline-flex gap-1" aria-label="Thinking">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse"
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        </>
      )}
      <div ref={endRef} />
    </div>
  );
}
