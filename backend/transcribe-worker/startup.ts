import { pingTranscribeAI } from "../shared/ai/ai_transcribe_client";
import { ping } from "../shared/bucket";
import { pingDb } from "../shared/db";
import { pingMQ } from "../shared/message-queue/messageQueue";
import { verifyServices } from "../shared/preflight";

export function verifyTranscribeWorkerServices(): Promise<void> {
  return verifyServices([
    { name: "RabbitMQ", check: pingMQ },
    { name: "Postgres", check: pingDb },
    { name: "Supabase Storage", check: ping },
    { name: "Deepgram", check: pingTranscribeAI },
  ]);
}
