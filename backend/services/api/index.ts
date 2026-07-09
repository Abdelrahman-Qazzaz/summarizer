const env = getApiEnv();

import { getApiEnv } from "../../shared/env";
import { startSocketServer } from "./src/sockets/socketManager";

import { mq } from "../../shared/message-queue/messageQueue";
import { db, AudioTranscriptionJobs } from "../../shared/db";
import { eq } from "drizzle-orm";

import { serve } from "@hono/node-server";
import { createApp } from "./app";

// createApp() runs the fail-fast preflight: if any third-party dependency is
// down (incl. RabbitMQ, which it also connects), the API never starts.
const app = await createApp();
export const port = env.PORT;

export const io = await startSocketServer();
mq.listen(mq.queues.SUMMARIZE_CHUNK, async ({ uploadId, userId, delta }) => {
  io.to(userId).emit("jobChunk", { uploadId, delta });
});
mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});
mq.listen(mq.queues.TRANSCRIBE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});
// youtube-fetcher couldn't download/upload the audio: mark the job failed and
// notify the user. The row was created by POST /upload/youtube.
mq.listen(mq.queues.YT_FETCH_FAILED, async ({ uploadId, userId, error }) => {
  await db
    .update(AudioTranscriptionJobs)
    .set({ status: "failed", error: error ?? "Failed to fetch YouTube audio" })
    .where(eq(AudioTranscriptionJobs.uploadId, uploadId));
  io.to(userId).emit("jobUpdated", { uploadId });
});

serve({ fetch: app.fetch, port });
