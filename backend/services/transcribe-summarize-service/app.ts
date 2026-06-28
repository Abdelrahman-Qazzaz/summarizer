import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyWorkerServices } from "./startup";

export async function createApp() {
  const app = new Hono();
  app.use("*", cors());

  await verifyWorkerServices();

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
