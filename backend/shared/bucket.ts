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

/**
 * How long an image URL is signed for. Long-lived because it's minted once at
 * upload and cached on the row — the model provider only needs seconds, but a
 * conversation reopened next week should not have to re-sign to render.
 */
export const IMAGE_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long an audio URL handed to the transcription provider stays valid. Long
 * enough to outlive a multi-hour file's transcription job and short enough that
 * the link is useless by the time the job row is history.
 */
const AUDIO_URL_TTL_SECONDS = 60 * 60;

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

/** The folder each kind of object lives in, under its owner. */
type ObjectKind = "images" | "audios" | "captions";

/**
 * Storage key `<userId>/<kind>/<storageObjectId>`. Both parts are structural:
 * every operation names the owner and the kind, so a wrong user or a wrong
 * kind yields a path that doesn't exist. The owner is what makes the
 * id-keyed functions below safe to call with untrusted ids. (The
 * youtube-fetcher builds the same key; keep them in sync.)
 */
function objectPath(
  userId: string,
  kind: ObjectKind,
  storageObjectId: UploadId,
) {
  return `${userId}/${kind}/${storageObjectId}`;
}

/**
 * Every upload lands here (no local write): one place that builds the key and
 * turns a storage error into a throw. The exported wrappers below add the
 * per-kind type guard and nothing else. Returns the storage path.
 */
async function uploadObject(
  userId: string,
  kind: ObjectKind,
  storageObjectId: UploadId,
  file: File,
) {
  const { data, error } = await bucket().upload(
    objectPath(userId, kind, storageObjectId),
    file,
    { contentType: file.type, upsert: false },
  );

  if (error) throw error;
  return data.path;
}

/** Upload speech audio. Rejects anything not declaring an `audio/*` type. */
export async function uploadAudioToBucket(
  userId: string,
  audioUploadId: UploadId,
  file: File,
) {
  if (!file.type.startsWith("audio/")) {
    throw new Error(`Expected an audio file, got: ${file.type || "unknown"}`);
  }

  return uploadObject(userId, "audios", audioUploadId, file);
}

/** Upload an image. Rejects anything not declaring an `image/*` type. */
export async function uploadImageToBucket(
  userId: string,
  imageUploadId: UploadId,
  file: File,
) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`Expected an image file, got: ${file.type || "unknown"}`);
  }

  return uploadObject(userId, "images", imageUploadId, file);
}

/** A caption track the youtube-fetcher stored in place of audio. */
export async function getCaptionText(
  userId: string,
  captionUploadId: UploadId,
) {
  const { data, error } = await bucket().download(
    objectPath(userId, "captions", captionUploadId),
  );

  if (error) throw error;
  return data.text();
}

/** One remove call for any mix of one owner's objects. No-ops on an empty list. */
async function removeObjects(
  userId: string,
  objects: readonly { kind: ObjectKind; storageObjectId: string }[],
) {
  if (objects.length === 0) return [];

  const { data, error } = await bucket().remove(
    objects.map(({ kind, storageObjectId }) =>
      objectPath(userId, kind, storageObjectId as UploadId),
    ),
  );

  if (error) throw error;
  return data;
}

export async function deleteImagesFromBucket(
  userId: string,
  imageUploadIds: readonly string[],
) {
  return removeObjects(
    userId,
    imageUploadIds.map((storageObjectId) => ({
      kind: "images",
      storageObjectId,
    })),
  );
}

export async function deleteCaptionFromBucket(
  userId: string,
  captionUploadId: string,
) {
  return removeObjects(userId, [
    { kind: "captions", storageObjectId: captionUploadId },
  ]);
}

/** A transcription job's audio and, when it has one, its caption track. */
export async function deleteAudioJobFilesFromBucket(
  userId: string,
  audioUploadId: string,
  captionUploadId: string | null,
) {
  return removeObjects(userId, [
    { kind: "audios", storageObjectId: audioUploadId },
    ...(captionUploadId
      ? [{ kind: "captions" as const, storageObjectId: captionUploadId }]
      : []),
  ]);
}

/**
 * Image read URL: client thumbnails, and the fetchable URL the chat model is
 * given for vision input.
 */
export async function createSignedImageUrl(
  userId: string,
  imageUploadId: UploadId,
) {
  const { data, error } = await bucket().createSignedUrl(
    objectPath(userId, "images", imageUploadId),
    IMAGE_URL_TTL_SECONDS,
  );

  if (error) throw error;
  return data.signedUrl;
}

/** Audio read URL, which the transcription provider fetches for itself. */
export async function createSignedAudioUrl(
  userId: string,
  audioUploadId: UploadId,
) {
  const { data, error } = await bucket().createSignedUrl(
    objectPath(userId, "audios", audioUploadId),
    AUDIO_URL_TTL_SECONDS,
  );

  if (error) throw error;
  return data.signedUrl;
}

/**
 * Signs many images in one request. Returns imageUploadId → url, omitting any
 * the storage API couldn't sign. Callers may span owners; the path carries the
 * owner, so no grouping is needed.
 */
export async function createSignedImageUrls(
  entries: readonly { userId: string; storageObjectId: string }[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (entries.length === 0) return urls;

  const paths = entries.map((e) =>
    objectPath(e.userId, "images", e.storageObjectId as UploadId),
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
    if (url) urls.set(entry.storageObjectId, url);
  });
  return urls;
}
