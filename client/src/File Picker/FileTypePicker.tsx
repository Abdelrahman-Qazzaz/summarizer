import { useSummarizerUpload } from "../hooks/useSummarizerUpload";

export function FileTypePicker() {
  const {
    mode,
    setMode,
    setFile,
    setUploadError,
    setUploadMessage,
  } = useSummarizerUpload();

  return (
    <div className="mode" role="tablist" aria-label="Source type">
      <button
        type="button"
        role="tab"
        className="modeBtn"
        aria-selected={mode === "text"}
        onClick={() => {
          setMode("text");
          setFile(null);
          setUploadError(null);
          setUploadMessage(null);
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
          setUploadError(null);
          setUploadMessage(null);
        }}
      >
        Video
      </button>
      <button
        type="button"
        role="tab"
        className="modeBtn"
        aria-selected={mode === "audio"}
        onClick={() => {
          setMode("audio");
          setFile(null);
          setUploadError(null);
          setUploadMessage(null);
        }}
      >
        Audio
      </button>
    </div>
  );
}
