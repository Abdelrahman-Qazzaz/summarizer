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

// Cap on images entering the bucket (chat attachments / standalone uploads).
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * The single handle every object operation (upload/download/remove/sign) goes
 * through, so `supabase.storage` and the bucket name are named in one place.
 * (pingBucket uses the bucket-management API `getBucket`, not this handle.)
 */
function bucket() {
  return supabase.storage.from(BUCKET);
}

/** Startup health check: fails if Supabase is unreachable or the bucket is missing. */
export async function pingBucket(): Promise<void> {
  const { error } = await supabase.storage.getBucket(BUCKET);
  if (error) throw error;
}

/**
 * Storage key scoped under the owning user: `<userId>/<uploadId>`. Ownership
 * is enforced structurally — every bucket operation needs the caller to name
 * the owner, and a wrong user yields a path that doesn't exist. This is what
 * makes the uploadId-keyed delete/read functions safe to call with untrusted
 * ids. (The youtube-fetcher builds the same key; keep them in sync.)
 */
function objectPath(userId: string, uploadId: UploadId) {
  return `${userId}/${uploadId}`;
}

/**
 * Directly upload a text string to Supabase Storage (no local write).
 * Returns the storage path.
 */
export async function uploadTextToBucket(
  userId: string,
  uploadId: UploadId,
  text: string,
) {
  const body = new Blob([text], { type: "text/plain; charset=utf-8" });
  const { data, error } = await bucket().upload(
    objectPath(userId, uploadId),
    body,
    { contentType: "text/plain; charset=utf-8" },
  );

  if (error) throw error;
  return data.path;
}

/**
 * Directly upload audio bytes to Supabase Storage (no local write).
 * Pass audio as ArrayBuffer/Uint8Array/Buffer/Blob.
 * Returns the storage path.
 */
export async function uploadAudioToBucket(
  userId: string,
  uploadId: UploadId,
  file: File,
) {
  // Optional: ensure you're uploading an audio file
  if (!file.type.startsWith("audio/")) {
    throw new Error(`Expected an audio file, got: ${file.type || "unknown"}`);
  }

  const { data, error } = await bucket().upload(
    objectPath(userId, uploadId),
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

/**
 * Directly upload an image to Supabase Storage (no local write).
 * Returns the storage path.
 */
export async function uploadImageToBucket(
  userId: string,
  uploadId: UploadId,
  file: File,
) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`Expected an image file, got: ${file.type || "unknown"}`);
  }

  const { data, error } = await bucket().upload(
    objectPath(userId, uploadId),
    file,
    { contentType: file.type },
  );

  if (error) throw error;
  return data.path;
}

export async function readTextFile(userId: string, uploadId: UploadId) {
  const { data, error } = await bucket().download(objectPath(userId, uploadId));

  if (error) throw error;

  return await data.text();
}
export async function getAudioFile(userId: string, uploadId: UploadId) {
  const { data, error } = await bucket().download(objectPath(userId, uploadId));
  if (error) throw error;
  return data; // Blob
}
export async function deleteFileFromBucket(userId: string, uploadId: UploadId) {
  const { data, error } = await bucket().remove([objectPath(userId, uploadId)]);

  if (error) throw error;
  return data;
}
/**
 * If you need to read it back from a private bucket, generate a signed URL.
 */
async function signedUrl(path: string, seconds = 600) {
  const { data, error } = await bucket().createSignedUrl(path, seconds);

  if (error) throw error;
  return data.signedUrl;
}

/*
Only images use this today (client thumbnails + handing the model a fetchable URL for vision input).
*/
export async function getSignedUrl(
  userId: string,
  uploadId: UploadId,
  seconds = 600,
) {
  return signedUrl(objectPath(userId, uploadId), seconds);
}
