/**
 * What the bucket holds, declared in one place the way shared/db/schema.ts
 * declares the tables: the bucket's name, and for each kind of object its
 * folder and, for the kinds clients upload, their limits.
 */

import { isDeepStrictEqual } from "node:util";

// Exported so the API can publish it on /contract — the youtube-fetcher reads
// the bucket name from there instead of hardcoding it. Non-sensitive config,
// same as the queue names.
export const BUCKET = "Audio & Text files";

// Cap on audio files entering the bucket. Served on /contract so the
// youtube-fetcher enforces the same limit the API applies to direct uploads.
// Supabase's Free plan caps every upload in the project at 50 MB, and a
// bucket's limit can't exceed the project's, so this can only go higher with
// the plan.
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50MB

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
 * Everything that differs between kinds of stored object: the bucket it's
 * stored in and its folder there. Only images and audio are uploaded by
 * clients and signed for reading, so only they carry the rules for that. Text
 * is caption tracks the youtube-fetcher used to store here; nothing writes it
 * any more, and it stays a kind only so the sweeper can remove what is left.
 */
export const KINDS = {
  image: {
    bucket: BUCKET,
    folder: "images",
    upload: {
      contentTypePrefix: "image/",
      maxBytes: MAX_IMAGE_BYTES,
      readUrlTtlSeconds: IMAGE_URL_TTL_SECONDS,
    },
  },
  audio: {
    bucket: BUCKET,
    folder: "audios",
    upload: {
      contentTypePrefix: "audio/",
      maxBytes: MAX_AUDIO_BYTES,
      readUrlTtlSeconds: AUDIO_URL_TTL_SECONDS,
    },
  },
  text: { bucket: BUCKET, folder: "texts" },
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

/** A bucket's settings as the storage schema declares them. */
export type BucketSettings = {
  public: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
};

/**
 * What a bucket itself enforces on every upload, before anything reaches the
 * confirm step, including uploads through a signed URL, which can't carry
 * limits of their own. Derived from the kinds KINDS stores in it, so the two
 * can't disagree: the largest of their size limits, and their content types.
 * One bucket holds every kind, so an image is only held to the audio limit
 * here; the confirm step still applies each kind's own.
 */
function settingsFor(bucket: string): BucketSettings {
  const rules = Object.values(KINDS).flatMap((kind) =>
    kind.bucket === bucket && "upload" in kind ? [kind.upload] : [],
  );
  return {
    public: false,
    fileSizeLimit: Math.max(...rules.map((rule) => rule.maxBytes)),
    allowedMimeTypes: rules.map((rule) => `${rule.contentTypePrefix}*`),
  };
}

/**
 * Every bucket KINDS stores objects in, by name, with its settings.
 * `npm run storage:push` makes the live buckets match these.
 */
export const BUCKET_SETTINGS: Record<string, BucketSettings> =
  Object.fromEntries(
    Object.values(KINDS).map((kind) => [kind.bucket, settingsFor(kind.bucket)]),
  );

/** A bucket's settings as Supabase reports them; an unenforced limit is null. */
export type LiveBucketSettings = {
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
};

/**
 * Whether a bucket's live settings are the declared ones. The order its
 * content types are listed in doesn't matter.
 */
export function matchesBucketSettings(
  live: LiveBucketSettings,
  declared: BucketSettings,
) {
  const sorted = (types: readonly string[] | null) =>
    types ? [...types].sort() : null;
  return (
    live.public === declared.public &&
    live.fileSizeLimit === declared.fileSizeLimit &&
    isDeepStrictEqual(
      sorted(live.allowedMimeTypes),
      sorted(declared.allowedMimeTypes),
    )
  );
}
