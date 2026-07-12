import type { UploadPhase } from "../../lib/uploadJob";
import type { UploadMode } from "../../sourceMode";

export type QueueItemStatus = "processing" | "uploaded" | "error";

export type QueueItem = {
  /** Local id for the queue row (not the server uploadId). */
  id: string;
  /** File name, or the video URL for youtube items. */
  fileName: string;
  mode: UploadMode;
  /** Summary model (chosenModelId). */
  model: string;
  /** Transcription model (audio/video only). */
  transcriptionModel?: string;
  phase: UploadPhase | null;
  status: QueueItemStatus;
  /** Server uploadId once the upload completes; drives result polling. */
  uploadId: string | null;
  error: string | null;
};

export type InputMethod = "file" | "text";
