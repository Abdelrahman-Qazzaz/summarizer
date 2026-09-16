import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import {
  createSignedUrl,
  createUploadUrl,
  takeUploadedObject,
} from "../../../shared/bucket";
import {
  createImageAttachment,
  deleteOwnedUnlinkedUnreservedImageAttachment,
  resolveImages,
} from "../../../shared/data/images.data";
import { CTX_KEYS } from "../../../shared/keys";
import type { UploadId } from "../../../shared/types";

/**
 * POST /upload/image — a URL the browser PUTs an image to (dropped into the
 * chat, or uploaded from the navbar), straight into storage. The id is minted
 * here rather than chosen by the client.
 *
 * No row is written yet, so an upload that never completes leaves nothing for
 * the rest of the code to trip over.
 */
export async function handleImageUploadUrl(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const imageUploadId: UploadId = randomUUID();
  const signedUploadUrl = await createUploadUrl(userId, {
    kind: "image",
    uploadId: imageUploadId,
  });

  return c.json({ uploadId: imageUploadId, signedUploadUrl });
}

/**
 * POST /upload/image/confirm — the image is in the bucket: check it, record
 * it, and return a signed URL for the preview.
 *
 * The URL is persisted, not just returned: this runs while the user is still
 * typing, so caching it here is what keeps signing off the send path entirely.
 * The key carries the kind, so an id minted for audio finds nothing here.
 */
export async function handleImageConfirm(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const imageUploadId: UploadId = c.get(CTX_KEYS.imageUploadId);
  const fileName = c.get(CTX_KEYS.fileName);

  const image = { kind: "image", uploadId: imageUploadId } as const;
  const upload = await takeUploadedObject(userId, image);
  if (!upload.ok) {
    switch (upload.reason) {
      case "missing":
        return c.json({ message: "No uploaded image to confirm" }, 404);
      case "wrong-type":
        return c.json({ message: "File must be an image" }, 400);
      case "too-large":
        return c.json(
          { message: "Image is too large", maxBytes: upload.maxBytes },
          413,
        );
    }
  }

  const signedUrl = await createSignedUrl(userId, image);
  const created = await createImageAttachment({
    userId,
    imageUploadId,
    fileName,
    mimeType: upload.contentType,
    sizeBytes: upload.sizeBytes,
    signedUrl,
  });
  if (!created) {
    return c.json({ message: "This upload was already confirmed" }, 409);
  }

  return c.json({
    message: "File uploaded",
    imageUploadId,
    fileName,
    size: upload.sizeBytes,
    mimeType: upload.contentType,
    mode: "image" as const,
    signedUrl,
  });
}

/**
 * GET /upload/image/:imageUploadId — the URL for a previously uploaded image.
 * Served from the cached signature; only re-signs once that nears expiry.
 */
export async function handleGetImage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const imageUploadId = c.get(CTX_KEYS.imageUploadId);

  const [image] = await resolveImages(userId, [imageUploadId]);

  if (!image) return c.json({ message: "Image not found" }, 404);

  return c.json(image);
}

/** DELETE /upload/image/:imageUploadId — delete an unlinked, unreserved image attachment. */
export async function handleDeleteImage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const imageUploadId = c.get(CTX_KEYS.imageUploadId);
  await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);

  return c.json({ message: "Image deleted" });
}
