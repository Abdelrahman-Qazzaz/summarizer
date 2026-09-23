import { bucket, IMAGE_URL_TTL_SECONDS } from "./bucket";

/**
 * The only storage calls a data module may make: signing read URLs, which
 * changes nothing in the bucket. Everything else stays behind bucket.ts.
 */
export const sign = {
  createSignedUrl: bucket.createSignedUrl,
  createSignedUrls: bucket.createSignedUrls,
};

export { IMAGE_URL_TTL_SECONDS };
