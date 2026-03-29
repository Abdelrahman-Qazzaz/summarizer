import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "hono";
import { db, AudioTranscriptionJobs, TextSummarizationJobs } from "../db";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_TEXT_BYTES = 15 * 1024 * 1024; // 15MB
const TEXT_PREVIEW_CHARS = 2000;

type AudioSource = "video" | "audio";

function uploadRoot() {
  return process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
}

function safeBaseName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return cleaned || "file";
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

  const uploadId = randomUUID();
  const dir = join(uploadRoot(), "audio");
  await mkdir(dir, { recursive: true });
  const dest = join(dir, `${uploadId}-${safeBaseName(file.name)}`);

  await Bun.write(dest, file);

  await db.insert(AudioTranscriptionJobs).values({
    uploadId,
    source,
    filePath: dest,
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

  const uploadId = randomUUID();
  const dir = join(uploadRoot(), "text");
  await mkdir(dir, { recursive: true });

  const text = await file.text();
  const dest = join(dir, `${uploadId}-${safeBaseName(file.name)}`);
  await Bun.write(dest, text);
  await db.insert(TextSummarizationJobs).values({
    uploadId,
    filePath: dest,
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
