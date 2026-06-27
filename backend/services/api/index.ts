const env = getApiEnv();

import { getApiEnv } from "../../shared/env";
import { startSocketServer } from "./src/sockets/socketManager";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { mq } from "../../shared/message-queue/messageQueue";
import { verifyServices } from "../../shared/preflight";
import { pingDb } from "../../shared/db";
import { pingBucket } from "../../shared/bucket";
import { pingRedis } from "../../shared/redis";
import { pingAi } from "../../shared/ai/ai_client";
import { pingWorkos } from "./src/auth/auth";

import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp();
export const port = env.PORT;

// Fail fast: if any third-party dependency is down, the API never starts.
await verifyServices([
  { name: "RabbitMQ", check: startMQ },
  { name: "Postgres", check: pingDb },
  { name: "Supabase Storage", check: pingBucket },
  { name: "Upstash Redis", check: pingRedis },
  { name: "WorkOS", check: pingWorkos },
  { name: "OpenRouter", check: pingAi },
]);

export const io = await startSocketServer();
mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});
mq.listen(mq.queues.TRANSCRIBE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});

serve({ fetch: app.fetch, port });
