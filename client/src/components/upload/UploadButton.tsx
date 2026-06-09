type UploadButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  uploading?: boolean;
  phase?: "extract" | "compress" | "upload" | null;
};

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
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
  );
}

function getButtonText(
  uploading: boolean,
  phase: "extract" | "compress" | "upload" | null,
) {
  if (!uploading) return "Upload & Process";
  if (phase === "extract") return "Extracting audio…";
  if (phase === "compress") return "Compressing audio…";
  if (phase === "upload") return "Uploading…";
  return "Processing…";
}

export function UploadButton({ onClick, disabled, uploading, phase }: UploadButtonProps) {
  const isDisabled = disabled || uploading;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`w-full flex items-center justify-center gap-2
        px-6 py-3.5 rounded-xl text-base font-semibold
        transition-all duration-200 ease-out
        focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900
        ${isDisabled
          ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
          : "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30"
        }`}
    >
      {uploading && <Spinner />}
      {getButtonText(uploading ?? false, phase ?? null)}
    </button>
  );
}
