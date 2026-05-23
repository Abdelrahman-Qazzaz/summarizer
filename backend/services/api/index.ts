import { Hono } from "hono";
import { cors } from "hono/cors";

import { uploadRouter } from "./src/routes/upload.router";
import { startSocketServer } from "./src/sockets/socketManager";
import { startMQ } from "../../shared/message-queue/messageQueue";

import { serve } from "@hono/node-server";

export function registerRoutes(app: Hono) {
  app.route("/upload", uploadRouter);
}

const app = new Hono();
app.use("*", cors());
registerRoutes(app);
const port = Number(process.env.PORT) || 3001;

await startMQ();
export const io = await startSocketServer();

serve({ fetch: app.fetch, port });
