import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyServices } from "../../shared/preflight";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { pingDb } from "../../shared/db";
import { pingBucket } from "../../shared/bucket";
import { pingAi } from "../../shared/ai/ai_client";

export async function createApp() {
  const app = new Hono();
    app.use("*", cors());

    await verifyServices([
      { name: "RabbitMQ", check: startMQ },
      { name: "Postgres", check: pingDb },
      { name: "Supabase Storage", check: pingBucket },
      { name: "OpenRouter", check: pingAi },
    ]);
    
    app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
