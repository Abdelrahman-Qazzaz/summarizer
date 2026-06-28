const env = getApiEnv();

import { getApiEnv } from "../../shared/env";
import { startSocketServer } from "./src/sockets/socketManager";

import { mq } from "../../shared/message-queue/messageQueue";

import { serve } from "@hono/node-server";
import { createApp } from "./app";

// createApp() runs the fail-fast preflight: if any third-party dependency is
// down (incl. RabbitMQ, which it also connects), the API never starts.
const app = await createApp();
export const port = env.PORT;

export const io = await startSocketServer();
mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});
mq.listen(mq.queues.TRANSCRIBE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});

serve({ fetch: app.fetch, port });
