import { Hono } from "hono";
import { cors } from "hono/cors";
import { getApiEnv } from "../../shared/env";
import { jobsRouter } from "./src/routes/jobs.router";
import { uploadRouter } from "./src/routes/upload.router";
import { authRouter } from "./src/routes/auth.router";
import { modelsRouter } from "./src/routes/models.router";
import { verifyServices } from "../../shared/preflight";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { pingDb } from "../../shared/db";
import { pingBucket } from "../../shared/bucket";
import { pingRedis } from "../../shared/redis";
import { pingAi } from "../../shared/ai/ai_client";
import { pingWorkos } from "./src/auth/auth";

export async function createApp() {
  const env = getApiEnv();
  const app = new Hono();
  app.use("*", cors({ origin: env.CLIENT_URL, credentials: true }));


  await verifyServices([
    { name: "RabbitMQ", check: startMQ },
    { name: "Postgres", check: pingDb },
    { name: "Supabase Storage", check: pingBucket },
    { name: "Upstash Redis", check: pingRedis },
    { name: "WorkOS", check: pingWorkos },
    { name: "OpenRouter", check: pingAi },
  ]);
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/upload", uploadRouter);
  app.route("/auth", authRouter);
  app.route("/jobs", jobsRouter);
  app.route("/models", modelsRouter);
  return app;
}
