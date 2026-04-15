export function FilePicker({
  inputId,
  accept,
  pickFiles,
  dragOver,
  setDragOver,
  onDrop,
  dropTitle,
  dropHint,
  file,
  uploading,
  phase,
  uploadError,
  uploadMessage,
  onUpload,
  mode,
}: {
  inputId: string;
  accept: string;
  pickFiles: (files: FileList | null) => void;
  dragOver: boolean;
  setDragOver: (dragOver: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  dropTitle: string;
  dropHint: string;
  file: File | null;
  uploading: boolean;
  phase: "extract" | "upload" | null;
  uploadError: string | null;
  uploadMessage: string | null;
  onUpload: () => void;
  mode: string;
}) {
  return (
    <main className="main">
      <input
        id={inputId}
        type="file"
        className="srOnly"
        accept={accept}
        onChange={(e) => pickFiles(e.target.files)}
      />

      <label
        htmlFor={inputId}
        className={`dropzone ${dragOver ? "dropzoneActive" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <span className="dropzoneTitle">{dropTitle}</span>
        <span className="dropzoneHint">or click to choose — {dropHint}</span>
        {mode === "video" && (
          <span className="dropzonePrivacy">
            Audio is extracted in your browser; the video file is not uploaded.
          </span>
        )}
      </label>

      {file && (
        <p className="fileName" aria-live="polite">
          Selected: <strong>{file.name}</strong>
        </p>
      )}

      <button
        type="button"
        className="uploadBtn"
        disabled={!file || uploading}
        onClick={() => void onUpload()}
      >
        {uploading && phase === "extract"
          ? "Extracting audio…"
          : uploading
            ? "Uploading…"
            : "Upload"}
      </button>

      {uploadMessage && (
        <p className="uploadOk" role="status">
          {uploadMessage}
        </p>
      )}
      {uploadError && (
        <p className="uploadErr" role="alert">
          {uploadError}
        </p>
      )}
    </main>
  );
}
