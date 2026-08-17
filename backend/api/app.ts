import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { getApiEnv } from "../shared/env";
import { jobsRouter } from "./src/routes/jobs.router";
import { uploadRouter } from "./src/routes/upload.router";
import { authRouter } from "./src/routes/auth.router";
import { modelsRouter } from "./src/routes/models.router";
import { conversationsRouter } from "./src/routes/conversations.router";

import { BUCKET, MAX_AUDIO_BYTES } from "../shared/bucket";
import { verifyApiServices } from "./startup";
import { QUEUES } from "../shared/message-queue/messageQueue";

export async function createApp() {
  const env = getApiEnv();
  const app = new Hono();
  app.use("*", cors({ origin: env.CLIENT_URL, credentials: true }));
  // The model catalog is ~335KB of JSON and every client downloads it; gzip
  // takes that to ~40KB. Streamed chat replies are left alone: hono skips
  // text/event-stream by content type, and streamSSE sets Transfer-Encoding,
  // which this middleware also treats as already-encoded. Both guarantees are
  // covered by tests, because buffering the reply stream would be invisible
  // here and obvious to every user.
  app.use("*", compress());

  await verifyApiServices();

  app.get("/health", (c) => c.json({ ok: true }));
  // Cross-service contract: non-sensitive shared facts (queue names + bucket
  // name) the Python youtube-fetcher reads at boot so it never hand-mirrors
  // them. Public + unauthenticated on purpose — none of this is sensitive and
  // service callers have no session. Secrets (Supabase key, MQ_URL) are NOT
  // served here — those belong in a secrets manager / platform env.
  app.get("/contract", (c) =>
    c.json({
      queues: QUEUES,
      bucket: BUCKET,
      maxAudioBytes: MAX_AUDIO_BYTES,
    }),
  );
  app.route("/upload", uploadRouter);
  app.route("/auth", authRouter);
  app.route("/jobs", jobsRouter);
  app.route("/models", modelsRouter);
  app.route("/conversations", conversationsRouter);
  return app;
}
