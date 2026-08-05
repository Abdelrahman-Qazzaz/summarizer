import { verifyServices } from "../../shared/preflight";
import { startMQ } from "../../shared/message-queue/messageQueue";
import { pingDb } from "../../shared/db";
import { pingBucket } from "../../shared/bucket";
import { pingAi } from "../../shared/ai/ai_chat_client";
import { pingTranscriber } from "../../shared/ai/ai_transcribe_client";

/**
 * Fail-fast preflight for the worker: aborts startup if any third-party
 * dependency is unavailable.
 */
export function verifyWorkerServices(): Promise<void> {
  return verifyServices([
    { name: "RabbitMQ", check: startMQ },
    { name: "Postgres", check: pingDb },
    { name: "Supabase Storage", check: pingBucket },
    { name: "OpenRouter", check: pingAi },
    { name: "Deepgram", check: pingTranscriber },
  ]);
}
