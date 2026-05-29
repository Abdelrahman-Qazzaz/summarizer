import { getApiEnv } from "../../shared/env";

const env = getApiEnv();

import { Hono } from "hono";
import { cors } from "hono/cors";

import { jobsRouter } from "./src/routes/jobs.router";
import { uploadRouter } from "./src/routes/upload.router";
import { startSocketServer } from "./src/sockets/socketManager";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { mq } from "../../shared/message-queue/messageQueue";

import { serve } from "@hono/node-server";
import { authRouter } from "./src/routes/auth.router";

export function registerRoutes(app: Hono) {
  app.route("/upload", uploadRouter);
  app.route("/auth", authRouter);
  app.route("/jobs", jobsRouter);
}

const app = new Hono();
app.use(
  "*",
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
);
registerRoutes(app);
const port = env.PORT;

await startMQ();
export const io = await startSocketServer();
mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId, userId }) => {
  io.to(userId).emit("jobUpdated", { uploadId });
});

serve({ fetch: app.fetch, port });
