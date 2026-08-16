import type { DragEvent } from "react";
import { ModeSelector } from "../upload/ModeSelector";
import { DropZone } from "../upload/DropZone";
import { FilePreview } from "../upload/FilePreview";
import { ModelSelector } from "../models/ModelSelector";
import { UploadQueue } from "../upload/UploadQueue";
import { useUploadQueue } from "../../hooks/upload/UploadQueueProvider";

export function NewUploadPage() {
  const {
    inputId,
    mode,
    setMode,
    accept,
    dropTitle,
    dropHint,
    file,
    setFile,
    youtubeUrl,
    setYoutubeUrl,
    dragOver,
    setDragOver,
    pickFiles,
    onDrop,
    transcriptionModel,
    setTranscriptionPick,
    transcriptionOptions,
    modelsLoading,
    modelsError,
    formError,
    canAdd,
    addToQueue,
  } = useUploadQueue();

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
          New transcription
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Add audio, video, or a YouTube link — queue as many as you like.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-black/30 border border-gray-100 dark:border-gray-800">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <ModeSelector mode={mode} onModeChange={setMode} />
          </div>

          <ModelSelector
            label="Transcription model"
            models={transcriptionOptions}
            value={transcriptionModel}
            onChange={setTranscriptionPick}
            disabled={modelsLoading}
            loading={modelsLoading}
            error={modelsError}
          />

          {mode === "youtube" ? (
            <div className="space-y-2">
              <input
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                className="w-full px-4 py-3 text-sm rounded-xl border border-gray-200 dark:border-gray-700
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                  placeholder:text-gray-400 dark:placeholder:text-gray-500
                  focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The audio is downloaded and transcribed server-side — nothing to
                upload from this device.
              </p>
            </div>
          ) : file ? (
            <FilePreview file={file} onRemove={() => setFile(null)} />
          ) : (
            <DropZone
              key={mode}
              inputId={inputId}
              accept={accept}
              title={dropTitle}
              hint={dropHint}
              dragOver={dragOver}
              hasFile={false}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={onDrop}
              onFileSelect={pickFiles}
            />
          )}

          {formError && (
            <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl">
              <svg
                className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-red-700 dark:text-red-300">
                {formError}
              </p>
            </div>
          )}

          <button
            onClick={addToQueue}
            disabled={!canAdd}
            className={`w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-base font-semibold
              transition-all duration-200 ease-out
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900
              ${
                !canAdd
                  ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  : "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-lg shadow-primary-500/25 hover:shadow-xl"
              }`}
          >
            Add to queue
          </button>
        </div>
      </div>

      <UploadQueue />
    </div>
  );
}
