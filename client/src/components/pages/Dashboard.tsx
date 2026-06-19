import type { DragEvent } from "react";
import { Container } from "../layout/Container";
import { Logo } from "../layout/Logo";
import { ThemeToggle } from "../layout/ThemeToggle";
import { UserMenu } from "../auth/UserMenu";
import { ModeSelector } from "../upload/ModeSelector";
import { DropZone } from "../upload/DropZone";
import { FilePreview } from "../upload/FilePreview";
import { UploadButton } from "../upload/UploadButton";
import { JobStatus } from "../job/JobStatus";
import { JobResult } from "../job/JobResult";
import { ModelSelector } from "../models/ModelSelector";
import { useSummarizerUpload } from "../../hooks/useSummarizerUpload";

export function Dashboard() {
  const {
    inputId,
    mode,
    setMode,
    accept,
    file,
    setFile,
    dragOver,
    setDragOver,
    pickFiles,
    onDrop,
    uploading,
    phase,
    uploadError,
    uploadMessage,
    job,
    jobLoading,
    onUpload,
    dropTitle,
    dropHint,
    selectedModel,
    setSelectedModel,
    modelsLoading,
    modelsError,
    modelOptions,
    modelLabel,
  } = useSummarizerUpload();

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleRemoveFile = () => {
    setFile(null);
  };

  const canUpload = file && selectedModel && !uploading;

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-50 via-white to-primary-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-primary-950/30">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
        <Container className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">
              Summarizer
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </Container>
      </header>

      <main className="flex-1 py-8 sm:py-12">
        <Container>
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Upload a file
              </h1>
              <p className="text-gray-600 dark:text-gray-300">
                Choose your content type and upload a file to get started
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl shadow-gray-200/50 dark:shadow-black/30 border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="p-6 sm:p-8 space-y-6">
                <div className="flex justify-center">
                  <ModeSelector
                    mode={mode}
                    onModeChange={setMode}
                    disabled={uploading}
                  />
                </div>

                <ModelSelector
                  label={modelLabel}
                  models={modelOptions}
                  value={selectedModel}
                  onChange={setSelectedModel}
                  disabled={uploading || modelsLoading}
                  loading={modelsLoading}
                  error={modelsError}
                />

                {file ? (
                  <FilePreview
                    file={file}
                    onRemove={handleRemoveFile}
                    disabled={uploading}
                  />
                ) : (
                  <DropZone
                    key={mode}
                    inputId={inputId}
                    accept={accept}
                    title={dropTitle}
                    hint={dropHint}
                    dragOver={dragOver}
                    hasFile={false}
                    disabled={uploading}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={onDrop}
                    onFileSelect={pickFiles}
                  />
                )}

                {uploadError && (
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
                    <p className="text-sm text-red-700 dark:text-red-300">{uploadError}</p>
                  </div>
                )}

                {uploadMessage && !job && (
                  <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl">
                    <svg
                      className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <p className="text-sm text-blue-700 dark:text-blue-300">{uploadMessage}</p>
                  </div>
                )}

                <UploadButton
                  onClick={onUpload}
                  disabled={!canUpload}
                  uploading={uploading}
                  phase={phase}
                />
              </div>

              {job && (
                <div className="border-t border-gray-100 dark:border-gray-800 p-6 sm:p-8 bg-gray-50/50 dark:bg-gray-950/50 space-y-4">
                  <JobStatus status={job.status} loading={jobLoading} />
                  <JobResult job={job} />
                </div>
              )}
            </div>
          </div>
        </Container>
      </main>
    </div>
  );
}
