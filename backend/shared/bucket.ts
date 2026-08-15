import { createClient } from "@supabase/supabase-js";
import { getBaseEnv } from "./env";
import type { UploadId } from "./types";

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

export const IMAGE_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long an audio URL handed to the transcription provider stays valid. Long
 * enough to outlive a multi-hour file's transcription job and short enough that
 * the link is useless by the time the job row is history.
 */
export const AUDIO_URL_TTL_SECONDS = 60 * 60;

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
 * Every upload lands here (no local write): one place that builds the key and
 * turns a storage error into a throw. The exported wrappers below add the
 * per-kind type guard and nothing else. Returns the storage path.
 */
async function uploadObject(
  userId: string,
  uploadId: UploadId,
  body: Blob,
  contentType: string,
  upsert = false,
) {
  const { data, error } = await bucket().upload(
    objectPath(userId, uploadId),
    body, // File is a Blob, so callers can pass one directly
    { contentType, upsert },
  );

  if (error) throw error;
  return data.path;
}

/** Upload speech audio. Rejects anything not declaring an `audio/*` type. */
export async function uploadAudioToBucket(
  userId: string,
  uploadId: UploadId,
  file: File,
) {
  if (!file.type.startsWith("audio/")) {
    throw new Error(`Expected an audio file, got: ${file.type || "unknown"}`);
  }

  return uploadObject(userId, uploadId, file, file.type);
}

/** Upload an image. Rejects anything not declaring an `image/*` type. */
export async function uploadImageToBucket(
  userId: string,
  uploadId: UploadId,
  file: File,
) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`Expected an image file, got: ${file.type || "unknown"}`);
  }

  return uploadObject(userId, uploadId, file, file.type);
}

/** Counterpart to uploadObject: fetch the object bytes or throw. */
async function downloadObject(userId: string, uploadId: UploadId) {
  const { data, error } = await bucket().download(objectPath(userId, uploadId));

  if (error) throw error;
  return data; // Blob
}

export async function getAudioFile(userId: string, uploadId: UploadId) {
  return downloadObject(userId, uploadId);
}
/** One owner's objects in a single remove call. No-ops on an empty list. */
export async function deleteFilesFromBucket(
  userId: string,
  uploadIds: readonly string[],
) {
  if (uploadIds.length === 0) return [];

  const { data, error } = await bucket().remove(
    uploadIds.map((uploadId) => objectPath(userId, uploadId as UploadId)),
  );

  if (error) throw error;
  return data;
}
/**
 * How long an image URL is signed for. Long-lived because it's minted once at
 * upload and cached on the row — the model provider only needs seconds, but a
 * conversation reopened next week should not have to re-sign to render.
 */

/*
Images (client thumbnails + handing the model a fetchable URL for vision input)
and audio, which the transcription provider fetches for itself.
*/
export async function createSignedUrl(
  userId: string,
  uploadId: UploadId,
  ttlSeconds: number,
) {
  const { data, error } = await bucket().createSignedUrl(
    objectPath(userId, uploadId),
    ttlSeconds,
  );

  if (error) throw error;
  return data.signedUrl;
}

/**
 * Signs many objects in one request. Returns uploadId → url, omitting any the
 * storage API couldn't sign. Callers may span owners; the path carries the
 * owner, so no grouping is needed.
 */
export async function createSignedUrls(
  entries: readonly { userId: string; uploadId: string }[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (entries.length === 0) return urls;

  const paths = entries.map((e) =>
    objectPath(e.userId, e.uploadId as UploadId),
  );
  const { data, error } = await bucket().createSignedUrls(
    paths,
    IMAGE_URL_TTL_SECONDS,
  );
  if (error) throw error;

  const byPath = new Map(
    data.filter((d) => d.path && d.signedUrl).map((d) => [d.path, d.signedUrl]),
  );
  entries.forEach((entry, i) => {
    const url = byPath.get(paths[i]);
    if (url) urls.set(entry.uploadId, url);
  });
  return urls;
}
