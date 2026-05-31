const env = getApiEnv();

import { getApiEnv } from "../../shared/env";
import { startSocketServer } from "./src/sockets/socketManager";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { mq } from "../../shared/message-queue/messageQueue";

import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp();
export const port = env.PORT;

await startMQ();
export const io = await startSocketServer();
mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});

serve({ fetch: app.fetch, port });
