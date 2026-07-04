import { Hono } from "hono";
import { cors } from "hono/cors";
import { getApiEnv } from "../../shared/env";
import { jobsRouter } from "./src/routes/jobs.router";
import { uploadRouter } from "./src/routes/upload.router";
import { authRouter } from "./src/routes/auth.router";
import { modelsRouter } from "./src/routes/models.router";
import { mq } from "../../shared/message-queue/messageQueue";
import { BUCKET } from "../../shared/bucket";
import { verifyApiServices } from "./startup";

export async function createApp() {
  const env = getApiEnv();
  const app = new Hono();
  app.use("*", cors({ origin: env.CLIENT_URL, credentials: true }));

  await verifyApiServices();

  app.get("/health", (c) => c.json({ ok: true }));
  // Cross-service contract: non-sensitive shared facts (queue names + bucket
  // name) the Python youtube-fetcher reads at boot so it never hand-mirrors
  // them. Public + unauthenticated on purpose — none of this is sensitive and
  // service callers have no session. Secrets (Supabase key, MQ_URL) are NOT
  // served here — those belong in a secrets manager / platform env.
  app.get("/contract", (c) => c.json({ queues: mq.queues, bucket: BUCKET }));
  app.route("/upload", uploadRouter);
  app.route("/auth", authRouter);
  app.route("/jobs", jobsRouter);
  app.route("/models", modelsRouter);
  return app;
}
