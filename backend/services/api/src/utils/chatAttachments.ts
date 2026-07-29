import { eq } from "drizzle-orm";
import { ImageUploads, db } from "../../../../shared/db";
import {
  IMAGE_URL_TTL_SECONDS,
  getSignedUrls,
} from "../../../../shared/bucket";

export type ImageUploadRow = typeof ImageUploads.$inferSelect;

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
