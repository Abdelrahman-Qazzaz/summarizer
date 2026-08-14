import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import {
  ChatMessages,
  ImageUploads,
  db,
  type Executor,
} from "../../../shared/db";
import {
  IMAGE_URL_TTL_SECONDS,
  createSignedUrls,
} from "../../../shared/bucket";
import type { UploadId } from "../../../shared/message-queue/messageQueue";

/**
 * What resolving an image needs: the signature cache to decide whether to
 * re-sign, the message it hangs off so a batch can be grouped by turn, and the
 * metadata the client is handed. `userId` is a predicate here, not an output,
 * so it stays out.
 */
const imageUploadColumns = {
  uploadId: ImageUploads.uploadId,
  fileName: ImageUploads.fileName,
  mimeType: ImageUploads.mimeType,
  sizeBytes: ImageUploads.sizeBytes,
  signedUrl: ImageUploads.signedUrl,
  signedUrlExpiresAt: ImageUploads.signedUrlExpiresAt,
  messageId: ImageUploads.messageId,
};

type ImageUploadRow = Pick<
  typeof ImageUploads.$inferSelect,
  keyof typeof imageUploadColumns
>;

/** One image as the client and the model both receive it. */
export type ResolvedImage = {
  uploadId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

const SIGNED_URL_REFRESH_MARGIN_MS = 60 * 60 * 1000;

/** When a URL signed right now stops being valid — fills `signedUrlExpiresAt`. */
function getSignedUrlExpiryDate() {
  return new Date(Date.now() + IMAGE_URL_TTL_SECONDS * 1000);
}

/**
 * The row for an image already written to the bucket. Takes the signature
 * rather than making it, so the caller can hand the same URL straight back to
 * the client instead of reading it out again.
 */
export async function createImageUpload(upload: {
  userId: string;
  uploadId: UploadId;
  file: File;
  signedUrl: string;
}) {
  await db.insert(ImageUploads).values({
    uploadId: upload.uploadId,
    userId: upload.userId,
    fileName: upload.file.name,
    mimeType: upload.file.type,
    sizeBytes: upload.file.size,
    signedUrl: upload.signedUrl,
    signedUrlExpiresAt: getSignedUrlExpiryDate(),
  });
}

/** The subset of an image row needed to decide whether its url must be re-signed. */
type SignableImageRow = Pick<
  ImageUploadRow,
  "uploadId" | "signedUrl" | "signedUrlExpiresAt"
>;

function hasFreshSignedUrl(row: SignableImageRow) {
  if (!row.signedUrl || !row.signedUrlExpiresAt) return false;
  return (
    row.signedUrlExpiresAt.getTime() - Date.now() > SIGNED_URL_REFRESH_MARGIN_MS
  );
}

/**
 * Every read here is scoped to one owner, so `userId` is the constant part of
 * the predicate and the caller supplies only what narrows it further.
 */
async function findImageUploads(
  userId: string,
  filter: SQL | undefined,
): Promise<ImageUploadRow[]> {
  return db
    .select(imageUploadColumns)
    .from(ImageUploads)
    .where(and(eq(ImageUploads.userId, userId), filter))
    .orderBy(asc(ImageUploads.createdAt), asc(ImageUploads.uploadId));
}

/**
 * uploadId → usable url for a set of image rows, signing (and persisting the
 * signature on) only those whose stored url has expired. Takes just the fields
 * it reads, so a projection from a join can be passed straight in.
 */
export async function resolveImageUploadUrls(
  userId: string,
  rows: readonly SignableImageRow[],
): Promise<Map<string, string>> {
  const urlByUploadId = new Map<string, string>();
  const needsSigning: SignableImageRow[] = [];

  for (const row of rows) {
    if (hasFreshSignedUrl(row))
      urlByUploadId.set(row.uploadId, row.signedUrl as string);
    else needsSigning.push(row);
  }
  if (needsSigning.length === 0) return urlByUploadId;

  const freshlySigned = await createSignedUrls(
    needsSigning.map((row) => ({ userId, uploadId: row.uploadId })),
  );
  const expiresAt = getSignedUrlExpiryDate();

  await Promise.all(
    needsSigning.map((row) => {
      const url = freshlySigned.get(row.uploadId);
      if (!url) return;
      urlByUploadId.set(row.uploadId, url);
      return db
        .update(ImageUploads)
        .set({ signedUrl: url, signedUrlExpiresAt: expiresAt })
        .where(eq(ImageUploads.uploadId, row.uploadId));
    }),
  );

  return urlByUploadId;
}

function toResolvedImage(row: ImageUploadRow, url: string): ResolvedImage {
  // `url`, not `signedUrl`: the same key POST /upload/image and a message's
  // attachments use, so the client reads one field name everywhere.
  return {
    uploadId: row.uploadId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.sizeBytes,
    url,
  };
}

/**
 * (first, sign whatever expired), return each image's url. Ordered to match
 * `uploadIds`; ids with no row, or that could not be signed, are dropped.
 */
async function resolveImagesWhere(
  // Plain strings, not UploadId: these arrive from the wire (a request body or
  // a stored row), and are only trusted after findImageUploads matches them
  // against rows this user owns.
  userId: string,
  uploadIds: readonly string[],
  filter: SQL | undefined,
): Promise<ResolvedImage[]> {
  if (uploadIds.length === 0) return [];

  const rows = await findImageUploads(
    userId,
    and(inArray(ImageUploads.uploadId, [...uploadIds]), filter),
  );
  if (rows.length === 0) return [];

  const urlByUploadId = await resolveImageUploadUrls(userId, rows);
  const rowByUploadId = new Map(rows.map((row) => [row.uploadId, row]));

  return uploadIds.flatMap((uploadId) => {
    const row = rowByUploadId.get(uploadId);
    const url = urlByUploadId.get(uploadId);
    return row && url ? [toResolvedImage(row, url)] : [];
  });
}

/** The user's images by id, whether or not they've been sent on a message. */
export async function resolveImages(
  userId: string,
  uploadIds: readonly string[],
) {
  return resolveImagesWhere(userId, uploadIds, undefined);
}

/**
 * Only images not yet sent on a message — what a new turn is allowed to claim.
 * An id the user doesn't own, or already spent on an earlier message, is simply
 * absent from the result, which the caller reports as a missing attachment.
 */
export async function resolveUnattachedImages(
  userId: string,
  uploadIds: readonly string[],
) {
  return resolveImagesWhere(userId, uploadIds, isNull(ImageUploads.messageId));
}

/**
 * The attachments of many messages at once, keyed by message id — one query for
 * a whole page of history rather than one per turn. Messages with no images are
 * absent from the map.
 */
export async function resolveMessageImages(
  userId: string,
  messageIds: readonly string[],
): Promise<Map<string, ResolvedImage[]>> {
  const imagesByMessageId = new Map<string, ResolvedImage[]>();
  if (messageIds.length === 0) return imagesByMessageId;

  const rows = await findImageUploads(
    userId,
    inArray(ImageUploads.messageId, [...messageIds]),
  );
  if (rows.length === 0) return imagesByMessageId;

  const urlByUploadId = await resolveImageUploadUrls(userId, rows);

  for (const row of rows) {
    const url = urlByUploadId.get(row.uploadId);
    if (!row.messageId || !url) continue;

    const images = imagesByMessageId.get(row.messageId) ?? [];
    images.push(toResolvedImage(row, url));
    imagesByMessageId.set(row.messageId, images);
  }

  return imagesByMessageId;
}

async function findImageUploadIds(userId: string, filter: SQL | undefined) {
  const rows = await db
    .select({ uploadId: ImageUploads.uploadId })
    .from(ImageUploads)
    .where(and(eq(ImageUploads.userId, userId), filter));

  return rows.map((row) => row.uploadId);
}

/**
 * The bucket keys behind a message's images. Deleting the message cascades the
 * rows away, so callers read these *first* and hand them to
 * `deleteFilesFromBucket` after — otherwise the objects outlive every trace of
 * themselves.
 */
export async function findMessageImageUploadIds(
  userId: string,
  messageId: string,
) {
  return findImageUploadIds(userId, eq(ImageUploads.messageId, messageId));
}

/** Same, for every message in a conversation about to be deleted. */
export async function findConversationImageUploadIds(
  userId: string,
  conversationId: string,
) {
  return findImageUploadIds(
    userId,
    inArray(
      ImageUploads.messageId,
      db
        .select({ id: ChatMessages.id })
        .from(ChatMessages)
        .where(eq(ChatMessages.conversationId, conversationId)),
    ),
  );
}

/**
 * Binds uploads to the message they were sent with. `isNull` guards the claim:
 * two messages racing for the same upload means the first one wins and the
 * second simply carries one fewer attachment, rather than stealing it.
 */
export async function attachImagesToMessage(
  userId: string,
  messageId: string,
  uploadIds: readonly string[],
  executor: Executor = db,
) {
  if (uploadIds.length === 0) return;

  await executor
    .update(ImageUploads)
    .set({ messageId })
    .where(
      and(
        eq(ImageUploads.userId, userId),
        inArray(ImageUploads.uploadId, [...uploadIds]),
        isNull(ImageUploads.messageId),
      ),
    );
}
