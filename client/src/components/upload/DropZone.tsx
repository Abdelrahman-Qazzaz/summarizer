import type { DragEvent, ChangeEvent } from "react";

type DropZoneProps = {
  inputId: string;
  accept: string;
  title: string;
  hint: string;
  dragOver: boolean;
  hasFile: boolean;
  disabled?: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onFileSelect: (files: FileList | null) => void;
};

export function DropZone({
  inputId,
  accept,
  title,
  hint,
  dragOver,
  hasFile,
  disabled,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
}: DropZoneProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFileSelect(e.target.files);
  };

  return (
    <label
      htmlFor={inputId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex flex-col items-center justify-center
        w-full min-h-[200px] p-8
        border-2 border-dashed rounded-2xl
        transition-all duration-200 ease-out
        ${disabled
          ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed"
          : dragOver
            ? "border-primary-500 bg-primary-50 dark:bg-primary-950/40 scale-[1.02]"
            : hasFile
              ? "border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-950/20"
              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800/30 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50/30 dark:hover:bg-primary-950/20 cursor-pointer"
        }
      `}
    >
      <input
        id={inputId}
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
        className="sr-only"
      />

      <div className={`w-14 h-14 mb-4 rounded-2xl flex items-center justify-center
        transition-colors duration-200
        ${dragOver ? "bg-primary-200 dark:bg-primary-800" : "bg-primary-100 dark:bg-primary-900/50"}`}
      >
        <svg
          className={`w-7 h-7 transition-colors duration-200
            ${dragOver ? "text-primary-700 dark:text-primary-300" : "text-primary-600 dark:text-primary-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
      </div>

      <p className={`text-base font-medium mb-1 transition-colors duration-200
        ${dragOver ? "text-primary-700 dark:text-primary-300" : "text-gray-700 dark:text-gray-200"}`}
      >
        {dragOver ? "Drop to upload" : title}
      </p>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {hint}
      </p>

      {!hasFile && (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          or click to browse
        </p>
      )}
    </label>
  );
}
