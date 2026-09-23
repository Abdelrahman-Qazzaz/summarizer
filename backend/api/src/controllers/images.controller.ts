import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { bucket } from "../../../shared/storage/bucket";
import {
  checkUpload,
  confirmCheckedUpload,
  deleteObjects,
  startUpload,
} from "../../../shared/uploads";
import { data } from "../../../shared/data";
import { CTX_KEYS } from "../../../shared/keys";
import { ALREADY_CONFIRMED, uploadRejection } from "../utils/uploadRejection";
import type { UploadId } from "../../../shared/types";

/**
 * POST /upload/image — a URL the browser PUTs an image to (dropped into the
 * chat, or uploaded from the navbar), straight into storage. The id is minted
 * here rather than chosen by the client.
 *
 * Only the upload's ledger record is written, so an upload that never
 * completes leaves nothing for the rest of the code to trip over; the sweep
 * removes it.
 */
export async function handleImageUploadUrl(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const imageUploadId: UploadId = randomUUID();
  const signedUploadUrl = await startUpload(userId, {
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
 * The upload must be pending in the ledger for this user as an image, so an
 * id minted for audio is a 404. A rejected upload is left for the sweep.
 */
const IMAGE_WORDING = {
  noun: "image",
  wrongType: () => "File must be an image",
  tooLarge: "Image is too large",
};

export async function handleImageConfirm(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const imageUploadId: UploadId = c.get(CTX_KEYS.imageUploadId);
  const fileName = c.get(CTX_KEYS.fileName);

  const image = { kind: "image", uploadId: imageUploadId } as const;
  const upload = await checkUpload(userId, image);
  if (!upload.ok) {
    const [body, status] = uploadRejection(upload, IMAGE_WORDING);
    return c.json(body, status);
  }

  const signedUrl = await bucket.createSignedUrl(userId, image);
  const confirmed = await confirmCheckedUpload(userId, image, (executor) =>
    data.images.createImageAttachment(
      {
        userId,
        imageUploadId,
        fileName,
        mimeType: upload.contentType,
        sizeBytes: upload.sizeBytes,
        signedUrl,
      },
      executor,
    ),
  );
  if (!confirmed) {
    return c.json({ message: ALREADY_CONFIRMED }, 409);
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

  const [image] = await data.images.resolveImages(userId, [imageUploadId]);

  if (!image) return c.json({ message: "Image not found" }, 404);

  return c.json(image);
}

/** DELETE /upload/image/:imageUploadId — delete an unlinked, unreserved image attachment. */
export async function handleDeleteImage(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const imageUploadId = c.get(CTX_KEYS.imageUploadId);
  const deletedImageUploadId =
    await data.images.deleteOwnedUnlinkedUnreservedImageAttachment(
      userId,
      imageUploadId,
    );
  if (deletedImageUploadId) {
    await deleteObjects(userId, [
      { kind: "image", uploadId: deletedImageUploadId },
    ]);
  }

  return c.json({ message: "Image deleted" });
}
