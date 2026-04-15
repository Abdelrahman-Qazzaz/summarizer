export function FileTypePicker({
  mode,
  setMode,
  setFile,
  setUploadError,
  setUploadMessage,
}: {
  mode: string;
  setMode: (mode: string) => void;
  setFile: (file: File | null) => void;
  setUploadError: (error: string | null) => void;
  setUploadMessage: (message: string | null) => void;
}) {
  return (
    <div
      style={{ border: "2px solid red" }}
      className="mode"
      role="tablist"
      aria-label="Source type"
    >
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
