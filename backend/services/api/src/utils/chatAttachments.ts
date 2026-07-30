import { and, eq, inArray } from "drizzle-orm";
import { ChatAttachments, ImageUploads, db } from "../../../../shared/db";
import {
  IMAGE_URL_TTL_SECONDS,
  getSignedUrls,
} from "../../../../shared/bucket";

export type AttachmentRow = typeof ChatAttachments.$inferSelect;
export type ImageUploadRow = typeof ImageUploads.$inferSelect;

/** An attachment plus the URL to fetch it with, null if it couldn't be signed. */
export type ResolvedAttachment = { row: AttachmentRow; url: string | null };

/** Attachment input shape accepted on the create-message body. */
export type MessageAttachmentInput = { kind: "image"; uploadId: string };

/** Raised when an attached uploadId is unknown or owned by another user. */
export class InvalidAttachmentsError extends Error {
  constructor() {
    super("One or more attachments could not be found");
  }
}

/**
 * Re-sign this far ahead of expiry. Only has to cover the request in flight;
 * the margin exists so a URL never expires between being handed out and used.
 */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

function isFresh(row: ImageUploadRow) {
  if (!row.signedUrl || !row.signedUrlExpiresAt) return false;
  return row.signedUrlExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
}

/**
 *   fresh rows → cached url                       (0 calls, the normal case)
 *   stale rows → one batched sign, written back   (1 call)
 *
 * The cache is filled at upload time, so a conversation whose images were
 * attached this week never signs on the send path.
 */
export async function imageUrlsFor(
  rows: readonly ImageUploadRow[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const stale: ImageUploadRow[] = [];

  for (const row of rows) {
    if (isFresh(row)) urls.set(row.uploadId, row.signedUrl as string);
    else stale.push(row);
  }
  if (stale.length === 0) return urls;

  const signed = await getSignedUrls(stale);
  const expiresAt = new Date(Date.now() + IMAGE_URL_TTL_SECONDS * 1000);

  await Promise.all(
    stale.map((row) => {
      const url = signed.get(row.uploadId);
      if (!url) return;
      urls.set(row.uploadId, url);
      return db
        .update(ImageUploads)
        .set({ signedUrl: url, signedUrlExpiresAt: expiresAt })
        .where(eq(ImageUploads.uploadId, row.uploadId));
    }),
  );

  return urls;
}

/** The public projection of an attachment row, as the chat UI consumes it. */
export function toAttachmentJson(row: AttachmentRow, url: string | null) {
  return {
    id: row.id,
    kind: row.kind,
    uploadId: row.uploadId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    url,
  };
}

/** A vision content part pointing at an already-signed image URL. */
export function imageContentPart(url: string) {
  return { type: "image_url" as const, imageUrl: { url } };
}

/**
 * Ownership-checks the attached image uploadIds and returns the matching
 * ImageUploads rows. Throws if any referenced id doesn't exist or belongs to
 * another user — the caller turns that into a 400 before any streaming starts.
 */
export async function resolveImageAttachments(
  userId: string,
  attachments: MessageAttachmentInput[],
) {
  if (attachments.length === 0) return [];

  const uploadIds = attachments.map((a) => a.uploadId);
  const rows = await db
    .select()
    .from(ImageUploads)
    .where(
      and(
        eq(ImageUploads.userId, userId),
        inArray(ImageUploads.uploadId, uploadIds),
      ),
    );

  if (rows.length !== uploadIds.length) throw new InvalidAttachmentsError();

  return rows;
}

/**
 *   join   attachments → their upload rows        (1 query)
 *   resolve urls from the cache, re-signing stale (0 calls typically)
 *   → grouped by the message they hang off
 *
 * leftJoin so a kind with no ImageUploads row still comes back, just url-less.
 */
export async function attachmentsWithUrlsByMessageId(messageIds: string[]) {
  const byMessage = new Map<string, ResolvedAttachment[]>();
  if (messageIds.length === 0) return byMessage;

  const joined = await db
    .select({ attachment: ChatAttachments, upload: ImageUploads })
    .from(ChatAttachments)
    .leftJoin(ImageUploads, eq(ChatAttachments.uploadId, ImageUploads.uploadId))
    .where(inArray(ChatAttachments.messageId, messageIds));

  const uploads = joined
    .map((j) => j.upload)
    .filter((u): u is ImageUploadRow => u !== null);
  const urls = await imageUrlsFor(uploads);

  for (const { attachment } of joined) {
    const list = byMessage.get(attachment.messageId) ?? [];
    list.push({ row: attachment, url: urls.get(attachment.uploadId) ?? null });
    byMessage.set(attachment.messageId, list);
  }
  return byMessage;
}

/**
 * Persists the resolved uploads as attachments of `messageId`. Denormalizes the
 * file metadata so the chat UI can render a chip without joining back to the
 * kind-specific upload table.
 */
export async function insertAttachmentRows(
  messageId: string,
  imageRows: readonly ImageUploadRow[],
): Promise<AttachmentRow[]> {
  if (imageRows.length === 0) return [];

  return db
    .insert(ChatAttachments)
    .values(
      imageRows.map((row) => ({
        kind: "image" as const,
        uploadId: row.uploadId,
        fileName: row.fileName,
        mimeType: row.mimeType,
        messageId,
      })),
    )
    .returning();
}
