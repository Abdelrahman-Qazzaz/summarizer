import { getWorkerEnv } from "../../shared/env";

const env = getWorkerEnv();

import { startMQ } from "../../shared/message-queue/messageQueue";
import { attachListeners } from "./workers";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp()
const port = env.TRANSCRIBE_SUMMARIZE_SERVICE_PORT;

await startMQ();
attachListeners();

serve({ fetch: app.fetch, port });