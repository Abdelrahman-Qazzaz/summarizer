import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import {
  createSignedUrl,
  IMAGE_URL_TTL_SECONDS,
  uploadImageToBucket,
} from "../../../shared/bucket";
import {
  createImageAttachment,
  deleteOwnedUnlinkedUnreservedImageAttachment,
  resolveImages,
} from "../../../shared/data/images.data";
import { CTX_KEYS } from "../../../shared/keys";
import type { UploadId } from "../../../shared/types";

/**
 * POST /upload/image — stores an image (dropped into the chat, or uploaded
 * from the navbar) with no processing job. Returns a signed URL so the client
 * can preview it immediately.
 *
 * The URL is persisted, not just returned: this runs while the user is still
 * typing, so caching it here is what keeps signing off the send path entirely.
 */
export async function handleImageUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const file = c.get(CTX_KEYS.uploadFile);

  const imageUploadId: UploadId = randomUUID();

  await uploadImageToBucket(userId, imageUploadId, file);
  const signedUrl = await createSignedUrl(
    userId,
    imageUploadId,
    IMAGE_URL_TTL_SECONDS,
  );

  await createImageAttachment({ userId, imageUploadId, file, signedUrl });

  return c.json({
    message: "File uploaded",
    imageUploadId,
    fileName: file.name,
    size: file.size,
    mimeType: file.type,
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
