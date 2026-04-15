import { useCallback, useId, useState } from "react";
import { uploadAudioEndpoint, uploadTextEndpoint } from "./config";
import { extractAudioFromVideo } from "./lib/extractAudio";
import "./App.css";
import { FileTypePicker } from "./File Picker/FileTypePicker";
import { FilePicker } from "./File Picker/FilePicker";

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
      <FilePicker
        inputId={inputId}
        accept={accept}
        pickFiles={pickFiles}
        dragOver={dragOver}
        setDragOver={setDragOver}
        onDrop={onDrop}
        dropTitle={dropTitle}
        dropHint={dropHint}
        file={file}
        uploading={uploading}
        phase={phase}
        uploadError={uploadError}
        uploadMessage={uploadMessage}
        onUpload={onUpload}
        mode={mode}
      />
    </div>
  );
}

export default App;
