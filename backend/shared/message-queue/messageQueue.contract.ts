import type { UploadId } from "../types";

export const QUEUES = {
  TRANSCRIBE: "transcribe",
  TRANSCRIBE_DONE: "transcribe_done",
  YT_FETCH: "yt_fetch",
  YT_FETCH_FAILED: "yt_fetch_failed",
} as const;

export type Queue = (typeof QUEUES)[keyof typeof QUEUES];
export type DeliveryMetadata = { redelivered: boolean };
export type QueuePayloads = {
  [QUEUES.TRANSCRIBE]: {
    uploadId: UploadId;
  };

  [QUEUES.TRANSCRIBE_DONE]: {
    uploadId: UploadId;
    userId: string;
  };

  [QUEUES.YT_FETCH]: {
    uploadId: UploadId;
    userId: string;
    url: string;
  };

  [QUEUES.YT_FETCH_FAILED]: {
    uploadId: UploadId;
    userId: string;
    error?: string;
  };
};
