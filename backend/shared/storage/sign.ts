import {
  IMAGE_URL_TTL_SECONDS,
  KINDS,
  objectPath,
  storage,
  type UploadableKind,
  type UploadableObject,
} from "./core";

export { IMAGE_URL_TTL_SECONDS };

/**
 * A read URL for one object, valid for its kind's TTL: a week for images
 * (client thumbnails and the chat model's vision input), an hour for audio
 * (which the transcription provider fetches for itself).
 */
async function createSignedUrl(userId: string, object: UploadableObject) {
  const { data, error } = await storage().createSignedUrl(
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
async function createSignedUrls(
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
  const { data, error } = await storage().createSignedUrls(
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

/**
 * The only storage calls a data module may make: signing read URLs, which
 * changes nothing in the bucket.
 */
export const sign = {
  url: createSignedUrl,
  urls: createSignedUrls,
};
