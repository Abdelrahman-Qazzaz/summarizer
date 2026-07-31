import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import {
  createSignedUrl,
  uploadImageToBucket,
} from "../../../../shared/bucket";
import { createImageUpload, resolveImages } from "../data/images.data";
import type { UploadId } from "../../../../shared/types/mq.types";
import { CTX_KEYS } from "../../../../shared/keys";

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

  const uploadId: UploadId = randomUUID();

  await uploadImageToBucket(userId, uploadId, file);
  const signedUrl = await createSignedUrl(userId, uploadId);

  await createImageUpload({ userId, uploadId, file, signedUrl });

  return c.json({
    message: "File uploaded",
    uploadId,
    fileName: file.name,
    size: file.size,
    mimeType: file.type,
    mode: "image" as const,
    signedUrl,
  });
}

/**
 * GET /upload/image/:uploadId — the URL for a previously uploaded image.
 * Served from the cached signature; only re-signs once that nears expiry.
 */
export async function handleGetImage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const uploadId = c.get(CTX_KEYS.uploadId);

  const [image] = await resolveImages(userId, [uploadId]);

  if (!image) return c.json({ message: "Image not found" }, 404);

  return c.json(image);
}
