import { verifyServices } from "../../shared/preflight";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { pingDb } from "../../shared/db";
import { pingBucket } from "../../shared/bucket";
import { pingRedis } from "../../shared/redis";
import { pingAi } from "../../shared/ai/ai_client";
import { pingWorkos } from "./src/auth/auth";

/**
 * Fail-fast preflight for the API: aborts startup if any third-party
 * dependency is unavailable.
 */
export function verifyApiServices(): Promise<void> {
  return verifyServices([
    { name: "RabbitMQ", check: startMQ },
    { name: "Postgres", check: pingDb },
    { name: "Supabase Storage", check: pingBucket },
    { name: "Upstash Redis", check: pingRedis },
    { name: "WorkOS", check: pingWorkos },
    { name: "OpenRouter", check: pingAi },
  ]);
}
