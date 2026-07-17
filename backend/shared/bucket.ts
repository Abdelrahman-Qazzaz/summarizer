import { createClient } from "@supabase/supabase-js";
import type { UploadId } from "./types/mq.types";
import { getBaseEnv } from "./env";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getBaseEnv();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Exported so the API can publish it on /contract — the youtube-fetcher reads
// the bucket name from there instead of hardcoding it. Non-sensitive config,
// same as the queue names.
export const BUCKET = "Audio & Text files";

// Cap on audio files entering the bucket. Served on /contract so the
// youtube-fetcher enforces the same limit the API applies to direct uploads.
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB

/** Startup health check: fails if Supabase is unreachable or the bucket is missing. */
export async function pingBucket(): Promise<void> {
  const { error } = await supabase.storage.getBucket(BUCKET);
  if (error) throw error;
}

/**
 * Directly upload a text string to Supabase Storage (no local write).
 * Returns the storage path.
 */
export async function uploadTextToBucket(uploadId: UploadId, text: string) {
  const body = new Blob([text], { type: "text/plain; charset=utf-8" });
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(uploadId, body, { contentType: "text/plain; charset=utf-8" });

  if (error) throw error;
  return data.path;
}

/**
 * Directly upload audio bytes to Supabase Storage (no local write).
 * Pass audio as ArrayBuffer/Uint8Array/Buffer/Blob.
 * Returns the storage path.
 */
export async function uploadAudioToBucket(uploadId: UploadId, file: File) {
  // Optional: ensure you're uploading an audio file
  if (!file.type.startsWith("audio/")) {
    throw new Error(`Expected an audio file, got: ${file.type || "unknown"}`);
  }

  const { data, error } = await supabase.storage.from(BUCKET).upload(
    uploadId,
    file, // File is a Blob, so you can pass it directly
    {
      contentType: file.type || "audio/mpeg",
      // Optional: prevent "already exists" errors by overwriting
      // upsert: true,
    },
  );

  if (error) throw error;
  return data.path;
}

export async function readTextFile(uploadId: UploadId) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(uploadId);

  if (error) throw error;

  return await data.text();
}
export async function getAudioFile(uploadId: UploadId) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(uploadId);
  if (error) throw error;
  return data; // Blob
}
export async function deleteFileFromBucket(uploadId: UploadId) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .remove([uploadId]);

  if (error) throw error;
  return data;
}
/**
 * If you need to read it back from a private bucket, generate a signed URL.
 */
async function signedUrl(path: string, seconds = 600) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, seconds);

  if (error) throw error;
  return data.signedUrl;
}
