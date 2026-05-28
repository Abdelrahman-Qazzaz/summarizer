import { getWorkerEnv } from "../../shared/env";

const env = getWorkerEnv();

import { Hono } from "hono";
import { cors } from "hono/cors";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { attachListeners } from "./workers";
import { serve } from "@hono/node-server";

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

const port = env.TRANSCRIBE_SUMMARIZE_SERVICE_PORT;

await startMQ();
attachListeners();

serve({ fetch: app.fetch, port });