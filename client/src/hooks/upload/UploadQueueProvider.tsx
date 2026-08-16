import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/useAuth";
import { useTranscriptionModelsQuery } from "../queries/useModelsQuery";
import { runUpload, runYoutubeUpload } from "../../lib/uploadJob";
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  resolveDefaultModel,
} from "../../lib/modelFilters";
import {
  acceptForMode,
  dropZoneCopy,
  isFileAcceptedForMode,
  isYoutubeUrl,
  rejectedFileMessage,
  type SourceMode,
  type UploadMode,
} from "../../sourceMode";
import type { QueueItem } from "./context";

let queueIdCounter = 0;

function useUploadQueueState() {
  const { user } = useAuth();
  const inputId = useId();
  const {
    entries,
    loading: modelsLoading,
    error: modelsError,
  } = useTranscriptionModelsQuery(!!user);

  const [mode, setMode] = useState<UploadMode>("audio");
  const [transcriptionPick, setTranscriptionPick] = useState<string | null>(
    null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);

  const fileMode: SourceMode = mode === "youtube" ? "audio" : mode;
  const accept = acceptForMode(fileMode);
  const { title: dropTitle, hint: dropHint } = dropZoneCopy(fileMode);

  const transcriptionOptions = useMemo(
    () =>
      entries.map(([id, info]) => ({
        id,
        label: info.name || id,
        info: {
          description: [
            info.architecture,
            info.languages?.length
              ? `${info.languages.length} languages`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      })),
    [entries],
  );

  const transcriptionModel =
    transcriptionPick ??
    resolveDefaultModel(
      entries.map(([modelId]) => modelId),
      DEFAULT_TRANSCRIPTION_MODEL,
    );

  const changeMode = useCallback((nextMode: UploadMode) => {
    setMode(nextMode);
    setFormError(null);
    // Keep a staged file only if the new mode is a file mode that accepts it.
    setFile((current) =>
      current &&
      nextMode !== "youtube" && isFileAcceptedForMode(current, nextMode)
        ? current
        : null,
    );
  }, []);

  const pickFiles = useCallback(
    (list: FileList | null) => {
      if (mode === "youtube") return;
      const next = list?.[0];
      if (!next) {
        setFile(null);
        return;
      }
      if (!isFileAcceptedForMode(next, mode)) {
        setFile(null);
        setFormError(rejectedFileMessage(mode));
        return;
      }
      setFile(next);
      setFormError(null);
    },
    [mode],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      pickFiles(e.dataTransfer.files);
    },
    [pickFiles],
  );

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const processItem = useCallback(
    async (
      id: string,
      uploadFile: File,
      itemMode: SourceMode,
      selectedTranscriptionModel: string,
    ) => {
      try {
        const uploadId = await runUpload(
          uploadFile,
          itemMode,
          selectedTranscriptionModel,
          (phase) => updateItem(id, { phase }),
        );
        updateItem(id, { status: "uploaded", phase: null, uploadId });
      } catch (e) {
        updateItem(id, {
          status: "error",
          phase: null,
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
    },
    [updateItem],
  );

  const processYoutubeItem = useCallback(
    async (id: string, url: string, selectedTranscriptionModel: string) => {
      try {
        const uploadId = await runYoutubeUpload(
          url,
          selectedTranscriptionModel,
        );
        updateItem(id, { status: "uploaded", phase: null, uploadId });
      } catch (e) {
        updateItem(id, {
          status: "error",
          phase: null,
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
    },
    [updateItem],
  );

  const addToQueue = useCallback(() => {
    if (!transcriptionModel) {
      setFormError("Select a transcription model first.");
      return;
    }

    if (mode === "youtube") {
      const url = youtubeUrl.trim();
      if (!isYoutubeUrl(url)) {
        setFormError("Enter a valid YouTube URL (youtube.com or youtu.be).");
        return;
      }
      const id = `queue-${queueIdCounter++}`;
      const item: QueueItem = {
        id,
        fileName: url,
        mode,
        transcriptionModel,
        phase: "upload",
        status: "processing",
        uploadId: null,
        error: null,
      };
      setItems((current) => [item, ...current]);
      setFormError(null);
      setYoutubeUrl("");
      void processYoutubeItem(id, url, transcriptionModel);
      return;
    }

    if (!file) {
      setFormError("Choose a file first.");
      return;
    }

    const id = `queue-${queueIdCounter++}`;
    const item: QueueItem = {
      id,
      fileName: file.name,
      mode,
      transcriptionModel,
      phase: null,
      status: "processing",
      uploadId: null,
      error: null,
    };
    setItems((current) => [item, ...current]);
    setFormError(null);
    setFile(null);
    void processItem(id, file, mode, transcriptionModel);
  }, [
    file,
    mode,
    transcriptionModel,
    youtubeUrl,
    processItem,
    processYoutubeItem,
  ]);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((current) =>
      current.filter((item) => item.status === "processing"),
    );
  }, []);

  const hasModels = !!transcriptionModel;
  const hasInput =
    mode === "youtube" ? youtubeUrl.trim().length > 0 : !!file;
  const canAdd = hasModels && hasInput;

  return {
    inputId,
    mode,
    setMode: changeMode,
    accept,
    dropTitle,
    dropHint,
    file,
    setFile,
    youtubeUrl,
    setYoutubeUrl,
    dragOver,
    setDragOver,
    pickFiles,
    onDrop,
    transcriptionModel,
    setTranscriptionPick,
    transcriptionOptions,
    modelsLoading,
    modelsError,
    formError,
    canAdd,
    addToQueue,
    items,
    removeItem,
    clearFinished,
  };
}

type UploadQueueContextValue = ReturnType<typeof useUploadQueueState>;

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const value = useUploadQueueState();
  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUploadQueue(): UploadQueueContextValue {
  const ctx = useContext(UploadQueueContext);
  if (ctx === null) {
    throw new Error("useUploadQueue must be used within UploadQueueProvider");
  }
  return ctx;
}
