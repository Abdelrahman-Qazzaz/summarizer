import { Hono } from "hono";
import { cors } from "hono/cors";
import { uploadRouter } from "./src/routes/upload.router";
import { mq } from "./../../shared/message-queue/messageQueue";
import { serve } from "@hono/node-server";

export function registerRoutes(app: Hono) {
  app.route("/upload", uploadRouter);
}

const app = new Hono();
app.use("*", cors());
registerRoutes(app);
const port = Number(process.env.PORT) || 3001;

async function startMQ() {
  await mq.connect(process.env.MQ_URL!);

  mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId }) => {
    console.log("Summary done:", uploadId);

    // later: notify client via websocket/SSE
  });
}

startMQ();

serve({ fetch: app.fetch, port });
