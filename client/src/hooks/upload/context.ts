import type { UploadPhase } from "../../lib/uploadJob";
import type { UploadMode } from "../../sourceMode";

export type QueueItemStatus = "processing" | "uploaded" | "error";

export type QueueItem = {
  id: string;
  fileName: string;
  mode: UploadMode;
  transcriptionModel: string;
  phase: UploadPhase | null;
  status: QueueItemStatus;
  uploadId: string | null;
  error: string | null;
};
