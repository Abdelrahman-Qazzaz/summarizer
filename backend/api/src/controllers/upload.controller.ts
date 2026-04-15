import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "hono";
import { db, AudioTranscriptionJobs, TextSummarizationJobs } from "../../../db";
import { uploadTextToBucket, uploadAudioToBucket } from "../bucket";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_TEXT_BYTES = 15 * 1024 * 1024; // 15MB
const TEXT_PREVIEW_CHARS = 2000;

type AudioSource = "video" | "audio";
export type UploadId = `${string}-${string}-${string}-${string}-${string}`;
async function uploadTextFile(uploadId: UploadId, text: string) {
  await uploadTextToBucket(uploadId, text);
}

async function uploadAudioFile(uploadId: UploadId, file: File) {
  await uploadAudioToBucket(uploadId, file);
}

async function readMultipartFile(
  c: Context,
): Promise<
  { ok: true; formData: FormData } | { ok: false; response: Response }
> {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return {
      ok: false,
      response: c.json({ message: "Invalid multipart body" }, 400),
    };
  }
  return { ok: true, formData };
}

function parseAudioSource(raw: unknown): AudioSource | null {
  if (raw === null || raw === "") return "audio";
  if (typeof raw !== "string") return null;
  if (raw === "video" || raw === "audio") return raw;
  return null;
}

/** POST /upload/audio — speech audio (from direct upload or client-extracted from video). */
export async function handleAudioUpload(c: Context) {
  const parsed = await readMultipartFile(c);
  if (!parsed.ok) return parsed.response;

  const { formData } = parsed;
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ message: 'Expected a file field named "file"' }, 400);
  }

  const source = parseAudioSource(formData.get("source"));
  if (source === null) {
    return c.json(
      { message: 'Invalid source; use "video" or "audio" (or omit)' },
      400,
    );
  }
  const isMaxAudioSize = file.size > MAX_AUDIO_BYTES;
  if (isMaxAudioSize) {
    return c.json(
      { message: "Audio file is too large", maxBytes: MAX_AUDIO_BYTES },
      413,
    );
  }

  const uploadId: UploadId = randomUUID();
  await uploadAudioFile(uploadId, file);

  await db.insert(AudioTranscriptionJobs).values({
    uploadId,
    source,
    fileName: file.name,
    mimeType: file.type || null,
    sizeBytes: file.size,
  });

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
  const parsed = await readMultipartFile(c);
  if (!parsed.ok) return parsed.response;

  const file = parsed.formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ message: 'Expected a file field named "file"' }, 400);
  }

  const isMaxTextSize = file.size > MAX_TEXT_BYTES;
  if (isMaxTextSize) {
    return c.json(
      { message: "Text file is too large", maxBytes: MAX_TEXT_BYTES },
      413,
    );
  }

  const uploadId: UploadId = randomUUID();
  const text = await file.text();

  await uploadTextFile(uploadId, text);
  await db.insert(TextSummarizationJobs).values({
    uploadId,
    fileName: file.name,
    sizeBytes: file.size,
  });
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
