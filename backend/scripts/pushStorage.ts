/**
 * Makes the storage bucket match BUCKET_SETTINGS in shared/storage/schema.ts:
 * creates it when it's missing, otherwise updates it to the declared settings.
 * The storage counterpart of `npm run db`, which does the same for the tables.
 */
import { bucket } from "../shared/storage/bucket";
import {
  BUCKET,
  BUCKET_SETTINGS,
  matchesBucketSettings,
} from "../shared/storage/schema";

const live = await bucket.readSettings();

if (!live) {
  await bucket.create(BUCKET_SETTINGS);
  console.log(`Created bucket "${BUCKET}":`, BUCKET_SETTINGS);
} else if (matchesBucketSettings(live)) {
  console.log(`Bucket "${BUCKET}" already matches the schema`);
  console.log("  compared:", BUCKET_SETTINGS);
} else {
  await bucket.updateSettings(BUCKET_SETTINGS);
  console.log(`Updated bucket "${BUCKET}"`);
  console.log("  from:", live);
  console.log("  to:  ", BUCKET_SETTINGS);
}
