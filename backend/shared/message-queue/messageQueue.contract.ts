import type { UploadId } from "../types";

export const QUEUES = {
  TRANSCRIBE: "transcribe",
  TRANSCRIBE_DONE: "transcribe_done",
  YT_FETCH: "yt_fetch",
  YT_FETCH_FAILED: "yt_fetch_failed",
  CAPTION_TRANSCRIPT: "caption_transcript",
} as const;

export type Queue = (typeof QUEUES)[keyof typeof QUEUES];
export type DeliveryMetadata = { redelivered: boolean };
export type QueuePayloads = {
  [QUEUES.TRANSCRIBE]: {
    audioUploadId: UploadId;
  };

  [QUEUES.TRANSCRIBE_DONE]: {
    audioUploadId: UploadId;
    userId: string;
  };

  [QUEUES.YT_FETCH]: {
    audioUploadId: UploadId;
    captionUploadId: UploadId | null;
    userId: string;
    url: string;
    useCaptionsIfAvailable: boolean;
  };

  [QUEUES.YT_FETCH_FAILED]: {
    audioUploadId: UploadId;
    userId: string;
    error?: string;
  };

  [QUEUES.CAPTION_TRANSCRIPT]: {
    audioUploadId: UploadId;
  };
};
