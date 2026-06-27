import { getWorkerEnv } from "../../shared/env";

const env = getWorkerEnv();


import { attachListeners } from "./workers";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = await createApp()
const port = env.TRANSCRIBE_SUMMARIZE_SERVICE_PORT;


attachListeners();

serve({ fetch: app.fetch, port });