import { mq } from "../message-queue/messageQueue";
export type UploadId = `${string}-${string}-${string}-${string}-${string}`;

export type TranscribeEvent = {
  uploadId: UploadId;
};

export type SummarizeEvent = {
  uploadId: UploadId;
};

export type MQQueues = (typeof mq.queues)[keyof typeof mq.queues];