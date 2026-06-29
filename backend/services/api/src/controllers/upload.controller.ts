import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import {
  db,
  AudioTranscriptionJobs,
  TextSummarizationJobs,
} from "../../../../shared/db";
import {
  uploadTextToBucket,
  uploadAudioToBucket,
} from "../../../../shared/bucket";
import { mq } from "../../../../shared/message-queue/messageQueue";
import type { UploadId } from "../../../../shared/types/mq.types";
import { CTX_KEYS } from "../../../../shared/keys";

type AudioSource = "video" | "audio";

const TEXT_PREVIEW_CHARS = 2000;

function parseAudioSource(raw: unknown): AudioSource | null {
  if (raw === null || raw === "") return "audio";
  if (typeof raw !== "string") return null;
  if (raw === "video" || raw === "audio") return raw;
  return null;
}

/** POST /upload/audio — speech audio (from direct upload or client-extracted from video). */
export async function handleAudioUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const file = c.get(CTX_KEYS.uploadFile);
  const chosenModelId = c.get(CTX_KEYS.chosenModelId);
  const transcriptionModelId = c.get(CTX_KEYS.transcriptionModelId);

  const source = c.get(CTX_KEYS.audioSource);

  const uploadId: UploadId = randomUUID();
  await uploadAudioToBucket(uploadId, file);

  await db.insert(AudioTranscriptionJobs).values({
    uploadId,
    userId,
    source,
    fileName: file.name,
    mimeType: file.type || null,
    sizeBytes: file.size,
    chosenModelId,
    transcriptionModelId,
  });

  await mq.sendEvent(mq.queues.TRANSCRIBE, uploadId);
  return c.json({
    message: "File uploaded",
    uploadId,
    fileName: file.name,
    size: file.size,
    mimeType: file.type || null,
    source,
  });
}

/** POST /upload/text — plain text files for summarization. */
export async function handleTextUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const chosenModelId = c.get(CTX_KEYS.chosenModelId);
  const file = c.get(CTX_KEYS.uploadFile);

  const uploadId: UploadId = randomUUID();
  const text = await file.text();

  await uploadTextToBucket(uploadId, text);
  await db.insert(TextSummarizationJobs).values({
    uploadId,
    userId,
    fileName: file.name,
    sizeBytes: file.size,
    chosenModelId,
  });
  await mq.sendEvent(mq.queues.SUMMARIZE, uploadId);
  return c.json({
    message: "File uploaded",
    uploadId,
    fileName: file.name,
    size: file.size,
    mode: "text" as const,
    preview:
      text.length > TEXT_PREVIEW_CHARS
        ? `${text.slice(0, TEXT_PREVIEW_CHARS)}…`
        : text,
  });
}
