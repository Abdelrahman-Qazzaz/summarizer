import { createClient } from "@supabase/supabase-js";
import type { UploadId } from "../../../shared/types/mq.types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BUCKET = "Audio & Text files";

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
