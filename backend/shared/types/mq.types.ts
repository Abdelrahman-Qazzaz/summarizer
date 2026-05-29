import { mq } from "../message-queue/messageQueue";
export type UploadId = `${string}-${string}-${string}-${string}-${string}`;

export type TranscribeEvent = {
  uploadId: UploadId;
};

export type SummarizeEvent = {
  uploadId: UploadId;
};

export type SummarizeDoneEvent = {
  uploadId: UploadId;
  userId: string;
};

export type MQQueues = (typeof mq.queues)[keyof typeof mq.queues];