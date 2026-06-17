import { Hono } from "hono";
import { cors } from "hono/cors";
import { getApiEnv } from "../../shared/env";
import { jobsRouter } from "./src/routes/jobs.router";
import { uploadRouter } from "./src/routes/upload.router";
import { authRouter } from "./src/routes/auth.router";
import { modelsRouter } from "./src/routes/models.router";

export function createApp() {
  const env = getApiEnv();
  const app = new Hono();
  app.use("*", cors({ origin: env.CLIENT_URL, credentials: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/upload", uploadRouter);
  app.route("/auth", authRouter);
  app.route("/jobs", jobsRouter);
  app.route("/models", modelsRouter);
  return app;
}
