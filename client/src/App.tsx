import { useCallback, useId, useRef, useState } from "react";
import "./App.css";

type SourceMode = "text" | "video";

const TEXT_ACCEPT = ".txt,.md,.markdown,.text,text/plain";
const VIDEO_ACCEPT = "video/*";

function App() {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SourceMode>("text");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const accept = mode === "text" ? TEXT_ACCEPT : VIDEO_ACCEPT;

  const pickFiles = useCallback((list: FileList | null) => {
    const next = list?.[0];
    setFile(next ?? null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles],
  );

  const onUpload = () => {
    if (!file) return;
    // Wire API / processing here
    console.info("upload", { mode, name: file.name, size: file.size });
  };

  return (
    <div className="app">
      <header className="top">
        <h1 className="title">Summarizer</h1>
        <div className="mode" role="tablist" aria-label="Source type">
          <button
            type="button"
            role="tab"
            className="modeBtn"
            aria-selected={mode === "text"}
            onClick={() => {
              setMode("text");
              setFile(null);
            }}
          >
            Text
          </button>
          <button
            type="button"
            role="tab"
            className="modeBtn"
            aria-selected={mode === "video"}
            onClick={() => {
              setMode("video");
              setFile(null);
            }}
          >
            Video
          </button>
        </div>
      </header>

      <main className="main">
        <input
          ref={fileInputRef}
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
          <span className="dropzoneTitle">
            {mode === "text" ? "Drop a text file" : "Drop a video file"}
          </span>
          <span className="dropzoneHint">
            or click to choose —{" "}
            {mode === "text" ? ".txt, .md, …" : "MP4, WebM, …"}
          </span>
        </label>

        {file && (
          <p className="fileName" aria-live="polite">
            Selected: <strong>{file.name}</strong>
          </p>
        )}

        <button
          type="button"
          className="uploadBtn"
          disabled={!file}
          onClick={onUpload}
        >
          Upload
        </button>
      </main>
    </div>
  );
}

export default App;
