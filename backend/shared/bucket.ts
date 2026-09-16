import { createClient } from "@supabase/supabase-js";
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
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

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

/**
 * Everything that differs between kinds of stored object. Only images and
 * audio are uploaded by clients and signed for reading, so only they carry the
 * rules for that; text is written by the youtube-fetcher and only read back.
 */
const KINDS = {
  image: {
    folder: "images",
    upload: {
      contentTypePrefix: "image/",
      maxBytes: MAX_IMAGE_BYTES,
      readUrlTtlSeconds: IMAGE_URL_TTL_SECONDS,
    },
  },
  audio: {
    folder: "audios",
    upload: {
      contentTypePrefix: "audio/",
      maxBytes: MAX_AUDIO_BYTES,
      readUrlTtlSeconds: AUDIO_URL_TTL_SECONDS,
    },
  },
  text: { folder: "texts" },
} as const;

type StoredObjectKind = keyof typeof KINDS;

/** The kinds a client uploads directly and that can be signed for reading. */
type UploadableKind = {
  [K in StoredObjectKind]: (typeof KINDS)[K] extends { upload: object }
    ? K
    : never;
}[StoredObjectKind];

export type StoredObject = { kind: StoredObjectKind; uploadId: string };
type UploadableObject = { kind: UploadableKind; uploadId: string };

/**
 * Storage key `<userId>/<folder>/<uploadId>`. Both parts are structural: every
 * operation names the owner and the kind, so a wrong user or a wrong kind
 * yields a path that doesn't exist. The owner is what makes the id-keyed
 * functions below safe to call with untrusted ids; the kind is what stops an
 * upload minted as one kind from being confirmed as another. (The
 * youtube-fetcher builds the same key; keep them in sync.)
 */
function objectPath(userId: string, { kind, uploadId }: StoredObject) {
  return `${userId}/${KINDS[kind].folder}/${uploadId}`;
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
export async function createUploadUrl(
  userId: string,
  object: UploadableObject,
) {
  const { data, error } = await bucket().createSignedUploadUrl(
    objectPath(userId, object),
  );

  if (error) throw error;
  return data.signedUrl;
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
export async function takeUploadedObject(
  userId: string,
  object: UploadableObject,
) {
  const { contentTypePrefix, maxBytes } = KINDS[object.kind].upload;
  const path = objectPath(userId, object);
  const { data, error } = await bucket().info(path);

  if (error) {
    if (isMissingObject(error))
      return { ok: false, reason: "missing" } as const;
    throw error;
  }

  const sizeBytes = data.size ?? 0;
  const contentType = data.contentType ?? "";

  const reason = !contentType.startsWith(contentTypePrefix)
    ? "wrong-type"
    : sizeBytes > maxBytes
      ? "too-large"
      : null;

  if (reason) {
    const { error: removeError } = await bucket().remove([path]);
    if (removeError) throw removeError;
    return { ok: false, reason, contentType, maxBytes } as const;
  }

  return { ok: true, sizeBytes, contentType } as const;
}

/** Stored text, such as the caption track the youtube-fetcher saves in place of audio. */
export async function getTextFromBucket(userId: string, uploadId: string) {
  const { data, error } = await bucket().download(
    objectPath(userId, { kind: "text", uploadId }),
  );

  if (error) throw error;
  return data.text();
}

/**
 * Removes one owner's objects, of any mix of kinds, in a single request.
 * No-ops on an empty list.
 */
export async function deleteFromBucket(
  userId: string,
  objects: readonly StoredObject[],
) {
  if (objects.length === 0) return [];

  const { data, error } = await bucket().remove(
    objects.map((object) => objectPath(userId, object)),
  );

  if (error) throw error;
  return data;
}

/**
 * A read URL for one object, valid for its kind's TTL: a week for images
 * (client thumbnails and the chat model's vision input), an hour for audio
 * (which the transcription provider fetches for itself).
 */
export async function createSignedUrl(
  userId: string,
  object: UploadableObject,
) {
  const { data, error } = await bucket().createSignedUrl(
    objectPath(userId, object),
    KINDS[object.kind].upload.readUrlTtlSeconds,
  );

  if (error) throw error;
  return data.signedUrl;
}

/**
 * Signs many objects: one request per kind, since a request carries a single
 * TTL, all in parallel. Returns uploadId → url, omitting any the storage API
 * couldn't sign. Entries may span owners; the path carries the owner.
 */
export async function createSignedUrls(
  entries: readonly (UploadableObject & { userId: string })[],
): Promise<Map<string, string>> {
  const byKind = Map.groupBy(entries, (entry) => entry.kind);
  const signed = await Promise.all(
    [...byKind].map(([kind, group]) => signGroup(kind, group)),
  );
  return new Map(signed.flatMap((urls) => [...urls]));
}

async function signGroup(
  kind: UploadableKind,
  entries: readonly (UploadableObject & { userId: string })[],
) {
  const paths = entries.map((entry) => objectPath(entry.userId, entry));
  const { data, error } = await bucket().createSignedUrls(
    paths,
    KINDS[kind].upload.readUrlTtlSeconds,
  );
  if (error) throw error;

  const byPath = new Map(
    data.filter((d) => d.path && d.signedUrl).map((d) => [d.path, d.signedUrl]),
  );
  return entries.flatMap((entry, i) => {
    const url = byPath.get(paths[i]);
    return url ? [[entry.uploadId, url] as const] : [];
  });
}
