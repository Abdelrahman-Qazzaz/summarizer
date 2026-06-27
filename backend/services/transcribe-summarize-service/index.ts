import { getWorkerEnv } from "../../shared/env";

const env = getWorkerEnv();

import { startMQ } from "../../shared/message-queue/messageQueue";
import { verifyServices } from "../../shared/preflight";
import { pingDb } from "../../shared/db";
import { pingBucket } from "../../shared/bucket";
import { pingAi } from "../../shared/ai/ai_client";
import { attachListeners } from "./workers";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp()
const port = env.TRANSCRIBE_SUMMARIZE_SERVICE_PORT;

// Fail fast: if any third-party dependency is down, the worker never starts.
await verifyServices([
  { name: "RabbitMQ", check: startMQ },
  { name: "Postgres", check: pingDb },
  { name: "Supabase Storage", check: pingBucket },
  { name: "OpenRouter", check: pingAi },
]);

attachListeners();

serve({ fetch: app.fetch, port });