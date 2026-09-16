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
type ObjectKind = "images" | "audios" | "texts";

/**
 * Storage key `<userId>/<kind>/<storageObjectId>`. Both parts are structural:
 * every operation names the owner and the kind, so a wrong user or a wrong
 * kind yields a path that doesn't exist. The owner is what makes the
 * id-keyed functions below safe to call with untrusted ids; the kind is what
 * stops an upload minted as one kind from being confirmed as another. (The
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
 * A one-shot URL the browser can PUT a file to, so the bytes go straight from
 * the device to storage instead of through this process. The token is bound
 * to this exact key, so the client can neither choose its own path nor reuse
 * the URL for a second object; Supabase fixes its lifetime at two hours.
 *
 * Nothing here limits what actually lands: size and content type are the
 * client's to set until the object exists. takeUploadedObject settles both.
 */
async function createSignedUploadUrl(
  userId: string,
  kind: ObjectKind,
  storageObjectId: UploadId,
) {
  const { data, error } = await bucket().createSignedUploadUrl(
    objectPath(userId, kind, storageObjectId),
  );

  if (error) throw error;
  return data.signedUrl;
}

export async function createImageUploadUrl(
  userId: string,
  imageUploadId: UploadId,
) {
  return createSignedUploadUrl(userId, "images", imageUploadId);
}

export async function createAudioUploadUrl(
  userId: string,
  audioUploadId: UploadId,
) {
  return createSignedUploadUrl(userId, "audios", audioUploadId);
}

/** Storage reports a missing object as a 400 whose body carries "404". */
function isMissingObject(error: unknown) {
  const { status, statusCode } = error as {
    status?: number;
    statusCode?: string;
  };
  return status === 404 || statusCode === "404";
}

/**
 * The confirm half of a direct upload: what storage says landed, checked
 * against what the kind accepts. Neither size nor content type passed through
 * this process, so both are read back rather than taken from the client.
 *
 * A rejected object is deleted here. Its row is written only once this
 * accepts it, so a rejected object is referenced by nothing and would
 * otherwise sit in the bucket for good.
 */
async function takeUploadedObject(
  userId: string,
  kind: ObjectKind,
  storageObjectId: UploadId,
  accepts: { contentTypePrefix: string; maxBytes: number },
) {
  const path = objectPath(userId, kind, storageObjectId);
  const { data, error } = await bucket().info(path);

  if (error) {
    if (isMissingObject(error))
      return { ok: false, reason: "missing" } as const;
    throw error;
  }

  const sizeBytes = data.size ?? 0;
  const contentType = data.contentType ?? "";

  const reason = !contentType.startsWith(accepts.contentTypePrefix)
    ? "wrong-type"
    : sizeBytes > accepts.maxBytes
      ? "too-large"
      : null;

  if (reason) {
    const { error: removeError } = await bucket().remove([path]);
    if (removeError) throw removeError;
    return { ok: false, reason, contentType } as const;
  }

  return { ok: true, sizeBytes, contentType } as const;
}

export async function takeUploadedImage(
  userId: string,
  imageUploadId: UploadId,
) {
  return takeUploadedObject(userId, "images", imageUploadId, {
    contentTypePrefix: "image/",
    maxBytes: MAX_IMAGE_BYTES,
  });
}

export async function takeUploadedAudio(
  userId: string,
  audioUploadId: UploadId,
) {
  return takeUploadedObject(userId, "audios", audioUploadId, {
    contentTypePrefix: "audio/",
    maxBytes: MAX_AUDIO_BYTES,
  });
}

/** Stored text, such as the caption track the youtube-fetcher saves in place of audio. */
export async function getTextFromBucket(
  userId: string,
  textUploadId: UploadId,
) {
  const { data, error } = await bucket().download(
    objectPath(userId, "texts", textUploadId),
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

export async function deleteTextFromBucket(
  userId: string,
  textUploadId: string,
) {
  return removeObjects(userId, [
    { kind: "texts", storageObjectId: textUploadId },
  ]);
}

/** A transcription job's audio and, when it has one, its caption text. */
export async function deleteAudioJobFilesFromBucket(
  userId: string,
  audioUploadId: string,
  captionUploadId: string | null,
) {
  return removeObjects(userId, [
    { kind: "audios", storageObjectId: audioUploadId },
    ...(captionUploadId
      ? [{ kind: "texts" as const, storageObjectId: captionUploadId }]
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
