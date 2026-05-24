import { useAuth } from "../hooks/auth/useAuth";
import { useSummarizerUpload } from "../hooks/useSummarizerUpload";

export function FilePicker() {
  const { user, loading: authLoading } = useAuth();
  const {
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
  } = useSummarizerUpload();

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

      {!authLoading && !user && (
        <p className="uploadErr" role="status">
          Sign in to upload files.
        </p>
      )}

      <button
        type="button"
        className="uploadBtn"
        disabled={!file || uploading || authLoading || !user}
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
