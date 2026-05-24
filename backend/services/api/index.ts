import { Hono } from "hono";
import { cors } from "hono/cors";

import { uploadRouter } from "./src/routes/upload.router";
import { startSocketServer } from "./src/sockets/socketManager";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { mq } from "../../shared/message-queue/messageQueue";

import { serve } from "@hono/node-server";
import { authRouter } from "./src/routes/auth.router";

export function registerRoutes(app: Hono) {
  app.route("/upload", uploadRouter);
  app.route("/auth",authRouter)
}

const app = new Hono();
app.use("*", cors());
registerRoutes(app);
const port = Number(process.env.PORT) || 3001;

await startMQ();
export const io = await startSocketServer();
mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId }) => {
  console.log("Summary done:", uploadId);
  // TODO: emit socket "jobUpdated" event to client (roomId = userId)
});

serve({ fetch: app.fetch, port });
