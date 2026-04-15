import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

const port = Number(process.env.TRANSCRIBE_SUMMARIZE_SERVICE_PORT) || 3002;

export default {
  port,
  fetch: app.fetch,
};
