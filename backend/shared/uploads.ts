import {
  createUploadUrl,
  deleteFromBucket,
  inspectUploadedObject,
  type StoredObject,
  type UploadableObject,
} from "./bucket";
import type { Executor } from "./db";
import {
  confirmUpload,
  findLedgerEntry,
  forgetObjects,
  recordPendingUpload,
} from "./data/storageLedger.data";

/**
 * How long after its URL is handed out an upload can still be confirmed. At
 * least as long as the URL itself is valid, so no upload can land after the
 * window has closed; startUpload enforces that against the real lifetime.
 */
export const UPLOAD_CONFIRM_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * An upload URL for a new object, recorded as pending. The URL isn't
 * returned unless the record exists, so no upload can land unrecorded.
 */
export async function startUpload(userId: string, object: UploadableObject) {
  const [, { signedUrl, lifetimeMs }] = await Promise.all([
    recordPendingUpload({ userId, ...object }),
    createUploadUrl(userId, object),
  ]);

  if (lifetimeMs > UPLOAD_CONFIRM_WINDOW_MS) {
    throw new Error(
      `Upload URLs are valid for ${lifetimeMs} ms, longer than the ` +
        `${UPLOAD_CONFIRM_WINDOW_MS} ms confirm window: an upload could land ` +
        "after its record has been swept",
    );
  }
  return signedUrl;
}

/**
 * Whether an upload can be confirmed, and what storage says it is. Writes
 * nothing either way: a rejected upload stays pending, and the sweep removes
 * it once it's past its grace.
 */
export async function checkUpload(userId: string, object: UploadableObject) {
  const entry = await findLedgerEntry({ userId, ...object });

  if (entry?.status === "confirmed") {
    return { ok: false, reason: "already-confirmed" } as const;
  }
  if (entry?.status !== "pending") {
    return { ok: false, reason: "missing" } as const;
  }
  if (Date.now() - entry.createdAt.getTime() > UPLOAD_CONFIRM_WINDOW_MS) {
    return { ok: false, reason: "expired" } as const;
  }

  return inspectUploadedObject(userId, object);
}

/**
 * Confirms a checked upload and writes the rows that reference it, in one
 * transaction. False when it's no longer pending and in its window — another
 * confirm got there first.
 */
export async function confirmCheckedUpload(
  userId: string,
  object: UploadableObject,
  write: (executor: Executor) => Promise<unknown>,
) {
  return confirmUpload({ userId, ...object }, UPLOAD_CONFIRM_WINDOW_MS, write);
}

/**
 * Deletes objects marked deleted (or never confirmed) from storage, then
 * their records. A failure leaves the records for the sweep.
 */
export async function releaseObjects(
  userId: string,
  objects: readonly StoredObject[],
) {
  if (objects.length === 0) return;

  await deleteFromBucket(userId, objects);
  await forgetObjects(userId, objects);
}
