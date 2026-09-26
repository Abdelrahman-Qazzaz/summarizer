/**
 * Makes the storage bucket match BUCKET_SETTINGS in shared/storage/schema.ts:
 * creates it when it's missing, otherwise updates it to the declared settings.
 * The storage counterpart of `npm run db`, which does the same for the tables.
 */
import { isDeepStrictEqual } from "node:util";
import { bucket } from "../shared/storage/bucket";
import { BUCKET, BUCKET_SETTINGS } from "../shared/storage/schema";

type Settings = {
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
};

/** Settings as compared: the order content types are listed in doesn't matter. */
function comparable(settings: Settings) {
  return {
    ...settings,
    allowedMimeTypes: settings.allowedMimeTypes
      ? [...settings.allowedMimeTypes].sort()
      : null,
  };
}

const live = await bucket.readSettings();

if (!live) {
  await bucket.create(BUCKET_SETTINGS);
  console.log(`Created bucket "${BUCKET}":`, BUCKET_SETTINGS);
} else if (isDeepStrictEqual(comparable(live), comparable(BUCKET_SETTINGS))) {
  console.log(`Bucket "${BUCKET}" already matches the schema`);
} else {
  await bucket.updateSettings(BUCKET_SETTINGS);
  console.log(`Updated bucket "${BUCKET}"`);
  console.log("  from:", live);
  console.log("  to:  ", BUCKET_SETTINGS);
}
