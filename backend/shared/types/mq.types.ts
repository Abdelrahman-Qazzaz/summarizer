export type UploadId = `${string}-${string}-${string}-${string}-${string}`;

/**
 * NOTE: the `transcribe` queue payload is the bare `UploadId` string, not an
 * object — producers send `sendEvent(TRANSCRIBE, uploadId)`. Anything that
 * publishes to `transcribe` (incl. the Python youtube-fetcher) must send the
 * bare JSON string, i.e. `JSON.stringify(uploadId)`.
 */
export type TranscribeEvent = UploadId;

/** `summarize` — like `transcribe`, the bare `UploadId` string, not an object. */
export type SummarizeEvent = UploadId;

export type TranscribeDoneEvent = {
  uploadId: UploadId;
  userId: string;
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

/** `yt_fetch` — api → youtube-fetcher: download this URL's audio into the bucket. */
export type YtFetchEvent = {
  uploadId: UploadId;
  url: string;
  userId: string;
};

/** `yt_fetch_failed` — youtube-fetcher → api: the download/upload failed. */
export type YtFetchFailedEvent = {
  uploadId: UploadId;
  userId: string;
  error?: string;
};

/**
 * The wire contract: every queue name mapped to the payload it carries.
 * `mq.sendEvent` / `mq.listen` are generic over this, so publishing or
 * consuming the wrong shape is a compile error rather than a runtime surprise
 * (e.g. sending `{ uploadId }` to `transcribe`, which takes a bare string).
 *
 * `mq.queues` is checked against this via `satisfies`, so adding a queue there
 * without adding its payload here fails to compile.
 */
export type QueuePayloads = {
  transcribe: TranscribeEvent;
  summarize: SummarizeEvent;
  summarize_chunk: SummarizeChunkEvent;
  transcribe_done: TranscribeDoneEvent;
  summarize_done: SummarizeDoneEvent;
  yt_fetch: YtFetchEvent;
  yt_fetch_failed: YtFetchFailedEvent;
};

export type MQQueues = keyof QueuePayloads;
