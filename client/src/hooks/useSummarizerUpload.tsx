import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { uploadAudioEndpoint, uploadTextEndpoint } from "../config";
import { useAuth } from "./auth/useAuth";
import { fetchJob, type Job } from "../lib/jobs";
import { extractAudioFromVideo } from "../lib/extractAudio";
import { compressAudioForSpeech } from "../lib/compressAudio";
import { useJobUpdated } from "./socket/useJobUpdated";
import { useModels } from "./useModels";
import {
  filterModelsForMode,
  modelLabelForMode,
  resolveDefaultModel,
} from "../lib/modelFilters";
import {
  acceptForMode,
  dropZoneCopy,
  isFileAcceptedForMode,
  rejectedFileMessage,
  type SourceMode,
} from "../sourceMode";

function errorMessageFromBody(data: unknown, res: Response): string {
  if (data && typeof data === "object" && "message" in data) {
    return String((data as { message: unknown }).message);
  }
  return res.statusText;
}

function successMessageFromBody(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return null;
}

function uploadIdFromBody(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "uploadId" in data &&
    typeof (data as { uploadId: unknown }).uploadId === "string"
  ) {
    return (data as { uploadId: string }).uploadId;
  }
  return null;
}

function useSummarizerUploadState() {
  const { user } = useAuth();
  const inputId = useId();
  const { loading: modelsLoading, error: modelsError, entries } = useModels(!!user);
  const [mode, setMode] = useState<SourceMode>("text");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<"extract" | "compress" | "upload" | null>(
    null,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobLoading, setJobLoading] = useState(false);

  const loadJob = useCallback(async (uploadId: string) => {
    setJobLoading(true);
    try {
      setJob(await fetchJob(uploadId));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to load job");
    } finally {
      setJobLoading(false);
    }
  }, []);

  useJobUpdated(!!user, activeUploadId, (uploadId) => {
    void loadJob(uploadId);
  });

  const accept = acceptForMode(mode);
  const { title: dropTitle, hint: dropHint } = dropZoneCopy(mode);

  const filteredModelEntries = useMemo(
    () => filterModelsForMode(entries, mode),
    [entries, mode],
  );

  const modelOptions = useMemo(
    () =>
      filteredModelEntries.map(([id, info]) => ({
        id,
        label: id,
        info,
      })),
    [filteredModelEntries],
  );

  useEffect(() => {
    if (entries.length === 0) return;
    setSelectedModel(resolveDefaultModel(entries, mode));
  }, [entries, mode]);

  const pickFiles = useCallback(
    (list: FileList | null) => {
      const next = list?.[0];
      if (!next) {
        setFile(null);
        return;
      }

      if (!isFileAcceptedForMode(next, mode)) {
        setFile(null);
        setUploadError(rejectedFileMessage(mode));
        setUploadMessage(null);
        setActiveUploadId(null);
        setJob(null);
        return;
      }

      setFile(next);
      setUploadError(null);
      setUploadMessage(null);
      setActiveUploadId(null);
      setJob(null);
    },
    [mode],
  );

  const changeMode = useCallback((nextMode: SourceMode) => {
    setMode(nextMode);
    setFile((current) =>
      current && !isFileAcceptedForMode(current, nextMode) ? null : current,
    );
    setUploadError(null);
    setUploadMessage(null);
    setActiveUploadId(null);
    setJob(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles],
  );

  const onUpload = useCallback(async () => {
    if (!file || !selectedModel) return;
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
        setPhase("compress");
        uploadFile = await compressAudioForSpeech(uploadFile);
        setPhase("upload");

        body.append("file", uploadFile);
        body.append("source", mode === "video" ? "video" : "audio");
        url = uploadAudioEndpoint();
      }

      body.append("chosenModelId", selectedModel);

      if (mode === "text") {
        setPhase("upload");
      }

      const res = await fetch(url, {
        method: "POST",
        body,
        credentials: "include",
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = errorMessageFromBody(data, res);
        throw new Error(msg || `Upload failed (${res.status})`);
      }
      const uploadId = uploadIdFromBody(data);
      if (uploadId) {
        setActiveUploadId(uploadId);
        setJob(null);
        if (mode === "text") {
          setUploadMessage("Upload complete. Summarizing…");
        } else {
          const okMsg = successMessageFromBody(data);
          setUploadMessage(okMsg ?? "Upload complete.");
        }
      } else {
        const okMsg = successMessageFromBody(data);
        setUploadMessage(okMsg ?? "Upload complete.");
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setPhase(null);
    }
  }, [file, mode, selectedModel]);

  return {
    inputId,
    mode,
    setMode: changeMode,
    accept,
    file,
    setFile,
    dragOver,
    setDragOver,
    pickFiles,
    onDrop,
    uploading,
    phase,
    uploadError,
    setUploadError,
    uploadMessage,
    setUploadMessage,
    job,
    jobLoading,
    onUpload,
    dropTitle,
    dropHint,
    selectedModel,
    setSelectedModel,
    modelsLoading,
    modelsError,
    modelOptions,
    modelLabel: modelLabelForMode(mode),
  };
}

type SummarizerUploadContextValue = ReturnType<typeof useSummarizerUploadState>;

const SummarizerUploadContext =
  createContext<SummarizerUploadContextValue | null>(null);

export function SummarizerUploadProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useSummarizerUploadState();
  return (
    <SummarizerUploadContext.Provider value={value}>
      {children}
    </SummarizerUploadContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSummarizerUpload(): SummarizerUploadContextValue {
  const ctx = useContext(SummarizerUploadContext);
  if (ctx === null) {
    throw new Error(
      "useSummarizerUpload must be used within SummarizerUploadProvider",
    );
  }
  return ctx;
}
