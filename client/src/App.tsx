import { useCallback, useId, useState } from "react";
import { uploadAudioEndpoint, uploadTextEndpoint } from "./config";
import { extractAudioFromVideo } from "./lib/extractAudio";
import "./App.css";
import { FileTypePicker } from "./File Picker/FileTypePicker";

type SourceMode = "text" | "video" | "audio";

const TEXT_ACCEPT = ".txt,.md,.markdown,.text,text/plain";
const VIDEO_ACCEPT = "video/*";
const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm";

function App() {
  const inputId = useId();
  const [mode, setMode] = useState<SourceMode>("text");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<"extract" | "upload" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const accept =
    mode === "text"
      ? TEXT_ACCEPT
      : mode === "video"
        ? VIDEO_ACCEPT
        : AUDIO_ACCEPT;

  const pickFiles = useCallback((list: FileList | null) => {
    const next = list?.[0];
    setFile(next ?? null);
    setUploadError(null);
    setUploadMessage(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles],
  );

  const onUpload = async () => {
    if (!file) return;
    setUploadError(null);
    setUploadMessage(null);
    setUploading(true);
    setPhase(null);
    try {
      const body = new FormData();
      let url: string;

      if (mode === "text") {
        body.append("file", file);
        url = uploadTextEndpoint();
      } else {
        let uploadFile = file;
        if (mode === "video") {
          setPhase("extract");
          uploadFile = await extractAudioFromVideo(file);
        }
        setPhase("upload");
        body.append("file", uploadFile);
        body.append("source", mode === "video" ? "video" : "audio");
        url = uploadAudioEndpoint();
      }

      if (mode === "text") {
        setPhase("upload");
      }

      const res = await fetch(url, {
        method: "POST",
        body,
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && "message" in data
            ? String((data as { message: unknown }).message)
            : res.statusText;
        throw new Error(msg || `Upload failed (${res.status})`);
      }
      if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof (data as { message: unknown }).message === "string"
      ) {
        setUploadMessage((data as { message: string }).message);
      } else {
        setUploadMessage("Upload complete.");
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setPhase(null);
    }
  };

  const dropTitle =
    mode === "text"
      ? "Drop a text file"
      : mode === "video"
        ? "Drop a video file"
        : "Drop an audio file";

  const dropHint =
    mode === "text"
      ? ".txt, .md, …"
      : mode === "video"
        ? "MP4, WebM, …"
        : "MP3, WAV, M4A, …";

  return (
    <div className="app">
      <header className="top">
        <h1 className="title">Summarizer</h1>
        <FileTypePicker
          mode={mode}
          setMode={(mode: string) => setMode(mode as SourceMode)}
          setFile={setFile}
          setUploadError={setUploadError}
          setUploadMessage={setUploadMessage}
        />
      </header>

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
              Audio is extracted in your browser; the video file is not
              uploaded.
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
    </div>
  );
}

export default App;
