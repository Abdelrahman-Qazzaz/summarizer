import type { ChangeEvent, KeyboardEvent } from "react";
import { ModelSelector, type ModelOption } from "../models/ModelSelector";
import type { StagedImage } from "./types";

type TranscriptAttachment = {
  fileName: string;
  state: "loading" | "ready" | "error";
};

type ChatComposerProps = {
  messageContent: string;
  onMessageChange: (value: string) => void;
  stagedImages: StagedImage[];
  onAddImages: (files: FileList | null) => void;
  onRemoveImage: (localId: string) => void;
  transcriptAttachment: TranscriptAttachment | null;
  onRemoveTranscript: () => void;
  modelOptions: ModelOption[];
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  modelsLoading: boolean;
  modelsError: string | null;
  sending: boolean;
  canSend: boolean;
  onSend: () => void;
};

export function ChatComposer({
  messageContent,
  onMessageChange,
  stagedImages,
  onAddImages,
  onRemoveImage,
  transcriptAttachment,
  onRemoveTranscript,
  modelOptions,
  selectedModelId,
  onModelChange,
  modelsLoading,
  modelsError,
  sending,
  canSend,
  onSend,
}: ChatComposerProps) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onAddImages(event.target.files);
    event.target.value = "";
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 p-3 sm:p-4 space-y-3 bg-white dark:bg-gray-900">
      {(stagedImages.length > 0 || transcriptAttachment) && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {transcriptAttachment && (
            <div
              className={`flex items-center gap-2 flex-shrink-0 px-3 py-2 rounded-lg border text-xs ${
                transcriptAttachment.state === "error"
                  ? "border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
                  : "border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300"
              }`}
            >
              <span className="max-w-48 truncate">
                {transcriptAttachment.state === "loading"
                  ? "Loading transcript…"
                  : transcriptAttachment.state === "error"
                    ? "Transcript unavailable"
                    : `Transcript: ${transcriptAttachment.fileName}`}
              </span>
              <button
                type="button"
                onClick={onRemoveTranscript}
                aria-label="Remove transcript"
                className="text-current opacity-70 hover:opacity-100"
              >
                ×
              </button>
            </div>
          )}
          {stagedImages.map((image) => (
            <div key={image.localId} className="relative flex-shrink-0">
              <img
                src={image.previewUrl}
                alt={image.file.name}
                className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
              />
              <button
                type="button"
                onClick={() => onRemoveImage(image.localId)}
                disabled={sending}
                aria-label={`Remove ${image.file.name}`}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 text-white text-xs disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <ModelSelector
        label={stagedImages.length > 0 ? "Vision chat model" : "Chat model"}
        models={modelOptions}
        value={selectedModelId}
        onChange={onModelChange}
        disabled={modelsLoading || sending}
        loading={modelsLoading}
        error={modelsError}
      />

      <div className="flex items-end gap-2">
        <label className="flex-shrink-0 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
          <span className="sr-only">Add images</span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={sending || stagedImages.length >= 6}
            onChange={handleFileChange}
            className="sr-only"
          />
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </label>
        <textarea
          value={messageContent}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          maxLength={50_000}
          disabled={sending}
          placeholder="Write a message…"
          className="flex-1 min-w-0 px-3 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Up to 6 images, 10 MB each. Enter sends; Shift+Enter adds a line.
      </p>
    </div>
  );
}
