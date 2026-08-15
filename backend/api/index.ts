const env = getApiEnv();

import { getApiEnv } from "../shared/env";
import { startSocketServer } from "./src/sockets/socketManager";

import { mq } from "../shared/message-queue/messageQueue";
import { failAudioJobById } from "../shared/data/jobs.data";

import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { handleTranscribeJob } from "../shared/ai/ai_transcribe_client";

// createApp() runs the fail-fast preflight: if any third-party dependency is
// down (incl. RabbitMQ, which it also connects), the API never starts.
const app = await createApp();
export const port = env.PORT;

export const io = await startSocketServer();

await mq.consume(mq.queues.TRANSCRIBE, handleTranscribeJob);

await mq.consume(mq.queues.TRANSCRIBE_DONE, ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});
// youtube-fetcher couldn't download/upload the audio: mark the job failed and
// notify the user. The row was created by POST /upload/youtube.
await mq.consume(
  mq.queues.YT_FETCH_FAILED,
  async ({ uploadId, userId, error }) => {
    await failAudioJobById(uploadId, error ?? "Failed to fetch YouTube audio");
    io.to(userId).emit("jobUpdated", { uploadId });
  },
);

serve({ fetch: app.fetch, port });
