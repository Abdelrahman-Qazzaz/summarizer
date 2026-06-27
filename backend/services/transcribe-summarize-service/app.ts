import { Hono } from "hono";
import { cors } from "hono/cors";


export function createApp() {
  const app = new Hono();
    app.use("*", cors());
    app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
