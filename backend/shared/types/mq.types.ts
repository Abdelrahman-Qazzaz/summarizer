import { mq } from "../message-queue/messageQueue";
export type UploadId = `${string}-${string}-${string}-${string}-${string}`;

/**
 * NOTE: the `transcribe` queue payload is the bare `UploadId` string, not an
 * object — producers send `sendEvent(TRANSCRIBE, uploadId)`. Anything that
 * publishes to `transcribe` (incl. the Python youtube-fetcher) must send the
 * bare JSON string, i.e. `JSON.stringify(uploadId)`.
 */
export type TranscribeEvent = UploadId;

/** `fetch` — api → youtube-fetcher: download this URL's audio into the bucket. */
export type YT_FetchEvent = {
  uploadId: UploadId;
  url: string;
  userId: string;
};

/** `YT_FETCH_FAILED` — youtube-fetcher → api: the download/upload failed. */
export type YT_FetchFailedEvent = {
  uploadId: UploadId;
  userId: string;
  error?: string;
};

// TODO: make this the same as transcribe
export type SummarizeEvent = {
  uploadId: UploadId;
};

export type SummarizeDoneEvent = {
  uploadId: UploadId;
  userId: string;
};

export type SummarizeChunkEvent = {
  uploadId: UploadId;
  userId: string;
  delta: string;
};

export type MQQueues = (typeof mq.queues)[keyof typeof mq.queues];
