import { FilePicker } from "./File Picker/FilePicker";
import { FileTypePicker } from "./File Picker/FileTypePicker";
import { SummarizerUploadProvider } from "./hooks/useSummarizerUpload";

export function SummarizerUpload() {
  return (
    <SummarizerUploadProvider>
      <div className="app">
        <header className="top">
          <h1 className="title">Summarizer</h1>
          <FileTypePicker />
        </header>
        <FilePicker />
      </div>
    </SummarizerUploadProvider>
  );
}
