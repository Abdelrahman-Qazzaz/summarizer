/**
 * What bucket.ts and sign.ts share: the client, the object layout and the
 * per-kind rules. Internal to storage/; import bucket or sign instead.
 */
import { createClient } from "@supabase/supabase-js";
import { getBaseEnv } from "../env";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getBaseEnv();
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
 * (ping uses the bucket-management API `getBucket`, not this handle.)
 */
export function storage() {
  return supabase.storage.from(BUCKET);
}

/**
 * Everything that differs between kinds of stored object. Only images and
 * audio are uploaded by clients and signed for reading, so only they carry the
 * rules for that; text is written by the youtube-fetcher and only read back.
 */
export const KINDS = {
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

export type StoredObjectKind = keyof typeof KINDS;

/** The kinds a client uploads directly and that can be signed for reading. */
export type UploadableKind = {
  [K in StoredObjectKind]: (typeof KINDS)[K] extends { upload: object }
    ? K
    : never;
}[StoredObjectKind];

export type StoredObject = { kind: StoredObjectKind; uploadId: string };
export type UploadableObject = { kind: UploadableKind; uploadId: string };

/**
 * Storage key `<userId>/<folder>/<uploadId>`. Both parts are structural: every
 * operation names the owner and the kind, so a wrong user or a wrong kind
 * yields a path that doesn't exist. The owner is what makes the id-keyed
 * functions below safe to call with untrusted ids; the kind is what stops an
 * upload minted as one kind from being confirmed as another. (The
 * youtube-fetcher builds the same key; keep them in sync.)
 */
export function objectPath(userId: string, { kind, uploadId }: StoredObject) {
  return `${userId}/${KINDS[kind].folder}/${uploadId}`;
}
