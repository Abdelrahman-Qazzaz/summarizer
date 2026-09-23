import { randomUUID } from "node:crypto";
import {
  BUCKET,
  KINDS,
  objectPath,
  storage,
  supabase,
  type UploadableObject,
  type StoredObject,
} from "./core";

export { BUCKET, MAX_AUDIO_BYTES } from "./core";
export type { StoredObject, UploadableObject } from "./core";

/** Startup health check: fails if Supabase is unreachable or the bucket is missing. */
async function ping(): Promise<void> {
  const { error } = await supabase.storage.getBucket(BUCKET);
  if (error) throw error;
}

/**
 * A one-shot URL the browser can PUT a file to, so the bytes go straight from
 * the device to storage instead of through this process. The token is bound
 * to this exact key, so the client can neither choose its own path nor reuse
 * the URL for a second object.
 *
 * Nothing here limits what actually lands: size and content type are the
 * client's to set until the object exists. inspectUploadedObject reads both.
 */
async function createUploadUrl(userId: string, object: UploadableObject) {
  const { data, error } = await storage().createSignedUploadUrl(
    objectPath(userId, object),
  );

  if (error) throw error;
  return data.signedUrl;
}

/**
 * Startup check: fails when Supabase hands out upload URLs that stay valid
 * for longer than `maxLifetimeMs`.
 *
 * Supabase decides that lifetime (two hours today) and offers no way to set
 * it or read it back, so the only place it exists is inside the URL's own
 * token. If it ever outgrew the window an upload can be confirmed in, an
 * upload could land after its record had been swept and sit in the bucket
 * for good — so this stops a deploy rather than leaking storage quietly.
 *
 * Minting a URL creates no object, so the probe leaves nothing behind.
 */
async function verifyUploadUrlLifetime(maxLifetimeMs: number): Promise<void> {
  const { data, error } = await storage().createSignedUploadUrl(
    objectPath("preflight", { kind: "image", uploadId: randomUUID() }),
  );
  if (error) throw error;

  const lifetimeMs = tokenLifetimeMs(data.token);
  if (lifetimeMs > maxLifetimeMs) {
    throw new Error(
      `Upload URLs are valid for ${lifetimeMs} ms, longer than the ` +
        `${maxLifetimeMs} ms an upload can be confirmed in: an upload could ` +
        "land after its record has been swept",
    );
  }
}

/** How long a Supabase-signed token is valid for, from its own claims. */
function tokenLifetimeMs(token: string) {
  const [, payload] = token.split(".");
  const { iat, exp } = JSON.parse(
    Buffer.from(payload ?? "", "base64url").toString(),
  ) as { iat?: unknown; exp?: unknown };
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new Error("Upload token carries no lifetime");
  }
  return (exp - iat) * 1000;
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
 * What storage says landed under an upload, checked against what its kind
 * accepts. Neither size nor content type passed through this process, so both
 * are read back rather than taken from the client. Only reads: an object this
 * rejects is left for the sweep.
 */
async function inspectUploadedObject(userId: string, object: UploadableObject) {
  const { contentTypePrefix, maxBytes } = KINDS[object.kind].upload;
  const { data, error } = await storage().info(objectPath(userId, object));

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

  if (reason) return { ok: false, reason, contentType, maxBytes } as const;

  return { ok: true, sizeBytes, contentType } as const;
}

/** Stored text, such as the caption track the youtube-fetcher saves in place of audio. */
async function getText(userId: string, uploadId: string) {
  const { data, error } = await storage().download(
    objectPath(userId, { kind: "text", uploadId }),
  );

  if (error) throw error;
  return data.text();
}

/**
 * Removes one owner's objects, of any mix of kinds, in a single request.
 * No-ops on an empty list.
 */
async function deleteObjects(userId: string, objects: readonly StoredObject[]) {
  if (objects.length === 0) return [];

  const { data, error } = await storage().remove(
    objects.map((object) => objectPath(userId, object)),
  );

  if (error) throw error;
  return data;
}

export const bucket = {
  ping,
  createUploadUrl,
  verifyUploadUrlLifetime,
  inspectUploadedObject,
  getText,
  delete: deleteObjects,
};
