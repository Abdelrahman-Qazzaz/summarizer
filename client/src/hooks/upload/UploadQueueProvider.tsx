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
import { useModelsQuery } from "../queries/useModelsQuery";
import { runUpload, type UploadModels } from "../../lib/uploadJob";
import {
  filterModelsForMode,
  resolveDefaultModel,
} from "../../lib/modelFilters";
import {
  acceptForMode,
  dropZoneCopy,
  isFileAcceptedForMode,
  rejectedFileMessage,
  type SourceMode,
} from "../../sourceMode";
import type { InputMethod, QueueItem } from "./context";

let queueIdCounter = 0;

function useUploadQueueState() {
  const { user } = useAuth();
  const inputId = useId();
  const { entries, loading: modelsLoading, error: modelsError } =
    useModelsQuery(!!user);

  const [mode, setMode] = useState<SourceMode>("text");
  const [inputMethod, setInputMethod] = useState<InputMethod>("file");
  // Summary model (all modes) and transcription model (audio/video only).
  // `null` pick = fall back to the resolved default for that list.
  const [summaryPick, setSummaryPick] = useState<string | null>(null);
  const [transcriptionPick, setTranscriptionPick] = useState<string | null>(
    null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);

  const accept = acceptForMode(mode);
  const { title: dropTitle, hint: dropHint } = dropZoneCopy(mode);

  const summaryOptions = useMemo(
    () =>
      filterModelsForMode(entries, "text").map(([id, info]) => ({
        id,
        label: id,
        info,
      })),
    [entries],
  );
  const transcriptionOptions = useMemo(
    () =>
      filterModelsForMode(entries, "audio").map(([id, info]) => ({
        id,
        label: id,
        info,
      })),
    [entries],
  );

  const summaryModel =
    summaryPick ??
    (entries.length > 0 ? resolveDefaultModel(entries, "text") : null);
  const transcriptionModel =
    transcriptionPick ??
    (entries.length > 0 ? resolveDefaultModel(entries, "audio") : null);

  const changeMode = useCallback((nextMode: SourceMode) => {
    setMode(nextMode);
    setFormError(null);
    setFile((current) =>
      current && !isFileAcceptedForMode(current, nextMode) ? null : current,
    );
    // Paste-text only applies to text mode.
    if (nextMode !== "text") setInputMethod("file");
  }, []);

  const changeInputMethod = useCallback((next: InputMethod) => {
    setInputMethod(next);
    setFormError(null);
  }, []);

  const pickFiles = useCallback(
    (list: FileList | null) => {
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

  const updateItem = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const processItem = useCallback(
    async (
      id: string,
      uploadFile: File,
      itemMode: SourceMode,
      models: UploadModels,
    ) => {
      try {
        const uploadId = await runUpload(uploadFile, itemMode, models, (phase) =>
          updateItem(id, { phase }),
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
    if (!summaryModel) {
      setFormError("Select a summarization model first.");
      return;
    }
    if (mode !== "text" && !transcriptionModel) {
      setFormError("Select a transcription model first.");
      return;
    }

    let uploadFile: File;
    if (mode === "text" && inputMethod === "text") {
      const text = textInput.trim();
      if (!text) {
        setFormError("Enter some text to summarize.");
        return;
      }
      uploadFile = new File([text], `pasted-${Date.now()}.txt`, {
        type: "text/plain",
      });
    } else {
      if (!file) {
        setFormError("Choose a file first.");
        return;
      }
      uploadFile = file;
    }

    const models: UploadModels =
      mode === "text"
        ? { chosenModelId: summaryModel }
        : { chosenModelId: summaryModel, transcriptionModelId: transcriptionModel ?? undefined };

    const id = `queue-${queueIdCounter++}`;
    const item: QueueItem = {
      id,
      fileName: uploadFile.name,
      mode,
      model: summaryModel,
      transcriptionModel: mode === "text" ? undefined : transcriptionModel ?? undefined,
      phase: null,
      status: "processing",
      uploadId: null,
      error: null,
    };
    setItems((current) => [item, ...current]);
    setFormError(null);
    // Reset the staged inputs for the next add.
    setFile(null);
    setTextInput("");
    void processItem(id, uploadFile, mode, models);
  }, [
    file,
    inputMethod,
    mode,
    summaryModel,
    transcriptionModel,
    textInput,
    processItem,
  ]);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((current) => current.filter((item) => item.status === "processing"));
  }, []);

  const hasModels = !!summaryModel && (mode === "text" || !!transcriptionModel);
  const hasInput =
    mode === "text" && inputMethod === "text"
      ? textInput.trim().length > 0
      : !!file;
  const canAdd = hasModels && hasInput;

  return {
    inputId,
    mode,
    setMode: changeMode,
    inputMethod,
    setInputMethod: changeInputMethod,
    accept,
    dropTitle,
    dropHint,
    file,
    setFile,
    textInput,
    setTextInput,
    dragOver,
    setDragOver,
    pickFiles,
    onDrop,
    summaryModel,
    setSummaryPick,
    summaryOptions,
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
