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
import {
  isPdfUpload,
  extractPdfText,
  PdfExtractionError,
} from "../utils/pdfText";

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

/** POST /upload/youtube — a YouTube URL fetched out of band by youtube-fetcher. */
export async function handleYoutubeUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const url = c.get(CTX_KEYS.youtubeUrl);
  const chosenModelId = c.get(CTX_KEYS.chosenModelId);
  const transcriptionModelId = c.get(CTX_KEYS.transcriptionModelId);

  const uploadId: UploadId = randomUUID();

  // Created queued with placeholder file metadata — the youtube-fetcher hasn't
  // downloaded anything yet. It uploads the audio to the bucket at `uploadId`
  // then publishes `transcribe`, so the row is claimed by the transcribe worker
  // exactly like a normal audio upload.
  await db.insert(AudioTranscriptionJobs).values({
    uploadId,
    userId,
    source: "youtube",
    YT_sourceUrl: url,
    fileName: "YouTube audio",
    mimeType: null,
    sizeBytes: 0,
    chosenModelId,
    transcriptionModelId,
  });

  await mq.sendEvent(mq.queues.YT_FETCH, { uploadId, url, userId });
  return c.json({
    message: "Queued",
    uploadId,
    source: "youtube" as const,
    url,
  });
}

/** POST /upload/text — plain text or PDF files for summarization. */
export async function handleTextUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const chosenModelId = c.get(CTX_KEYS.chosenModelId);
  const file = c.get(CTX_KEYS.uploadFile);

  const uploadId: UploadId = randomUUID();
  let text: string;
  if (isPdfUpload(file)) {
    try {
      text = await extractPdfText(file);
    } catch (err) {
      if (err instanceof PdfExtractionError)
        return c.json({ message: err.message }, 422);
      throw err;
    }
  } else text = await file.text();

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
