import { verifyServices } from "../shared/preflight";
import { pingMQ } from "../shared/message-queue/messageQueue";
import { pingDb } from "../shared/db";
import { pingBucket, verifyUploadUrlLifetime } from "../shared/bucket";
import { pingRedis } from "../shared/cache/redis";
import { pingChatAI } from "../shared/ai/ai_chat_client";
import { pingWorkos } from "./src/auth/auth";
import { UPLOAD_CONFIRM_WINDOW_MS } from "../shared/uploads";

/**
 * Fail-fast preflight for the API: aborts startup if any third-party
 * dependency is unavailable.
 */
export function verifyApiServices(): Promise<void> {
  return verifyServices([
    { name: "RabbitMQ", check: pingMQ },
    { name: "Postgres", check: pingDb },
    { name: "Supabase Storage", check: pingBucket },
    // Only the API hands out upload URLs, so only it needs their lifetime to
    // fit inside the window an upload can be confirmed in.
    {
      name: "Supabase Storage upload URLs",
      check: () => verifyUploadUrlLifetime(UPLOAD_CONFIRM_WINDOW_MS),
    },
    { name: "Upstash Redis", check: pingRedis },
    { name: "WorkOS", check: pingWorkos },
    { name: "OpenRouter", check: pingChatAI },
  ]);
}
