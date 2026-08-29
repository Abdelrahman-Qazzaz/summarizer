import { and, asc, eq, inArray, notExists, type SQL } from "drizzle-orm";
import {
  AttachmentUploads,
  ChatMessageAttachments,
  ChatMessages,
  db,
  type Executor,
} from "../../../shared/db";
import {
  IMAGE_URL_TTL_SECONDS,
  createSignedUrls,
} from "../../../shared/bucket";
import type { UploadId } from "../../../shared/types";

/**
 * What resolving an image needs: the signature cache to decide whether to
 * re-sign, the message it hangs off so a batch can be grouped by turn, and the
 * metadata the client is handed. `userId` is a predicate here, not an output,
 * so it stays out.
 */
const imageUploadColumns = {
  imageUploadId: AttachmentUploads.attachmentUploadId,
  fileName: AttachmentUploads.fileName,
  mimeType: AttachmentUploads.mimeType,
  sizeBytes: AttachmentUploads.sizeBytes,
  signedUrl: AttachmentUploads.signedUrl,
  signedUrlExpiresAt: AttachmentUploads.signedUrlExpiresAt,
};

type ImageUploadRow = {
  imageUploadId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  signedUrl: string | null;
  signedUrlExpiresAt: Date | null;
};

/** One image as the client and the model both receive it. */
export type ResolvedImage = {
  imageUploadId: string;
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
  imageUploadId: UploadId;
  file: File;
  signedUrl: string;
}) {
  await db.insert(AttachmentUploads).values({
    attachmentUploadId: upload.imageUploadId,
    kind: "image",
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
  "imageUploadId" | "signedUrl" | "signedUrlExpiresAt"
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
    .from(AttachmentUploads)
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "image"),
        filter,
      ),
    )
    .orderBy(
      asc(AttachmentUploads.createdAt),
      asc(AttachmentUploads.attachmentUploadId),
    );
}

/**
 * imageUploadId → usable url for a set of image rows, signing (and persisting the
 * signature on) only those whose stored url has expired. Takes just the fields
 * it reads, so a projection from a join can be passed straight in.
 */
export async function resolveImageUploadUrls(
  userId: string,
  rows: readonly SignableImageRow[],
): Promise<Map<string, string>> {
  const urlByImageUploadId = new Map<string, string>();
  const needsSigning: SignableImageRow[] = [];

  for (const row of rows) {
    if (hasFreshSignedUrl(row))
      urlByImageUploadId.set(row.imageUploadId, row.signedUrl as string);
    else needsSigning.push(row);
  }
  if (needsSigning.length === 0) return urlByImageUploadId;

  const freshlySigned = await createSignedUrls(
    needsSigning.map((row) => ({
      userId,
      storageObjectId: row.imageUploadId,
    })),
  );
  const expiresAt = getSignedUrlExpiryDate();

  await Promise.all(
    needsSigning.map((row) => {
      const url = freshlySigned.get(row.imageUploadId);
      if (!url) return;
      urlByImageUploadId.set(row.imageUploadId, url);
      return db
        .update(AttachmentUploads)
        .set({ signedUrl: url, signedUrlExpiresAt: expiresAt })
        .where(eq(AttachmentUploads.attachmentUploadId, row.imageUploadId));
    }),
  );

  return urlByImageUploadId;
}

function toResolvedImage(row: ImageUploadRow, url: string): ResolvedImage {
  // `url`, not `signedUrl`: the same key POST /upload/image and a message's
  // attachments use, so the client reads one field name everywhere.
  return {
    imageUploadId: row.imageUploadId,
    fileName: row.fileName,
    mimeType: row.mimeType ?? "application/octet-stream",
    size: row.sizeBytes,
    url,
  };
}

/**
 * (first, sign whatever expired), return each image's url. Ordered to match
 * `imageUploadIds`; ids with no row, or that could not be signed, are dropped.
 */
async function resolveImagesWhere(
  // Plain strings, not UploadId: these arrive from the wire (a request body or
  // a stored row), and are only trusted after findImageUploads matches them
  // against rows this user owns.
  userId: string,
  imageUploadIds: readonly string[],
  filter: SQL | undefined,
): Promise<ResolvedImage[]> {
  if (imageUploadIds.length === 0) return [];

  const rows = await findImageUploads(
    userId,
    and(
      inArray(AttachmentUploads.attachmentUploadId, [...imageUploadIds]),
      filter,
    ),
  );
  if (rows.length === 0) return [];

  const urlByImageUploadId = await resolveImageUploadUrls(userId, rows);
  const rowByImageUploadId = new Map(
    rows.map((row) => [row.imageUploadId, row]),
  );

  return imageUploadIds.flatMap((imageUploadId) => {
    const row = rowByImageUploadId.get(imageUploadId);
    const url = urlByImageUploadId.get(imageUploadId);
    return row && url ? [toResolvedImage(row, url)] : [];
  });
}

/** The user's images by id, whether or not they've been sent on a message. */
export async function resolveImages(
  userId: string,
  imageUploadIds: readonly string[],
) {
  return resolveImagesWhere(userId, imageUploadIds, undefined);
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

  const rows = await db
    .select({
      ...imageUploadColumns,
      messageId: ChatMessageAttachments.messageId,
    })
    .from(ChatMessageAttachments)
    .innerJoin(
      AttachmentUploads,
      eq(
        AttachmentUploads.attachmentUploadId,
        ChatMessageAttachments.attachmentUploadId,
      ),
    )
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "image"),
        inArray(ChatMessageAttachments.messageId, [...messageIds]),
      ),
    )
    .orderBy(
      asc(ChatMessageAttachments.messageId),
      asc(ChatMessageAttachments.position),
    );
  if (rows.length === 0) return imagesByMessageId;

  const urlByImageUploadId = await resolveImageUploadUrls(userId, rows);

  for (const row of rows) {
    const url = urlByImageUploadId.get(row.imageUploadId);
    if (!row.messageId || !url) continue;

    const images = imagesByMessageId.get(row.messageId) ?? [];
    images.push(toResolvedImage(row, url));
    imagesByMessageId.set(row.messageId, images);
  }

  return imagesByMessageId;
}

async function findAttachedImageUploadIdsWhere(
  userId: string,
  filter: SQL | undefined,
) {
  const rows = await db
    .select({ imageUploadId: AttachmentUploads.attachmentUploadId })
    .from(ChatMessageAttachments)
    .innerJoin(
      AttachmentUploads,
      eq(
        AttachmentUploads.attachmentUploadId,
        ChatMessageAttachments.attachmentUploadId,
      ),
    )
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "image"),
        filter,
      ),
    );

  return rows.map((row) => row.imageUploadId);
}

/** Same, for every message in a conversation about to be deleted. */
export async function findConversationImageUploadIds(
  userId: string,
  conversationId: string,
) {
  return findAttachedImageUploadIdsWhere(
    userId,
    inArray(
      ChatMessageAttachments.messageId,
      db
        .select({ id: ChatMessages.id })
        .from(ChatMessages)
        .where(eq(ChatMessages.conversationId, conversationId)),
    ),
  );
}

export async function findOwnedUnattachedImageUploadId(
  userId: string,
  imageUploadId: string,
) {
  const [upload] = await db
    .select({ imageUploadId: AttachmentUploads.attachmentUploadId })
    .from(AttachmentUploads)
    .where(
      and(
        eq(AttachmentUploads.attachmentUploadId, imageUploadId),
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "image"),
        notExists(
          db
            .select({
              attachmentUploadId: ChatMessageAttachments.attachmentUploadId,
            })
            .from(ChatMessageAttachments)
            .where(
              eq(
                ChatMessageAttachments.attachmentUploadId,
                AttachmentUploads.attachmentUploadId,
              ),
            ),
        ),
      ),
    )
    .limit(1);

  return upload?.imageUploadId ?? null;
}

export async function deleteOwnedUnattachedImageUpload(
  userId: string,
  imageUploadId: string,
) {
  await db.delete(AttachmentUploads).where(
    and(
      eq(AttachmentUploads.userId, userId),
      eq(AttachmentUploads.attachmentUploadId, imageUploadId),
      eq(AttachmentUploads.kind, "image"),
      notExists(
        db
          .select({
            attachmentUploadId: ChatMessageAttachments.attachmentUploadId,
          })
          .from(ChatMessageAttachments)
          .where(
            eq(
              ChatMessageAttachments.attachmentUploadId,
              AttachmentUploads.attachmentUploadId,
            ),
          ),
      ),
    ),
  );
}

export async function deleteOrphanedImageUploads(
  userId: string,
  candidateImageUploadIds: readonly string[],
  executor: Executor = db,
) {
  const imageUploadIds = [...new Set(candidateImageUploadIds)];
  if (imageUploadIds.length === 0) return [];

  const deleted = await executor
    .delete(AttachmentUploads)
    .where(
      and(
        eq(AttachmentUploads.userId, userId),
        eq(AttachmentUploads.kind, "image"),
        inArray(AttachmentUploads.attachmentUploadId, imageUploadIds),
        notExists(
          executor
            .select({
              attachmentUploadId: ChatMessageAttachments.attachmentUploadId,
            })
            .from(ChatMessageAttachments)
            .where(
              eq(
                ChatMessageAttachments.attachmentUploadId,
                AttachmentUploads.attachmentUploadId,
              ),
            ),
        ),
      ),
    )
    .returning({
      imageUploadId: AttachmentUploads.attachmentUploadId,
    });

  return deleted.map((upload) => upload.imageUploadId);
}
