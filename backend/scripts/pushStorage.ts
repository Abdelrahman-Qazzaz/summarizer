/**
 * Makes the storage buckets match BUCKET_SETTINGS in shared/storage/schema.ts:
 * creates each one that's missing, and updates any other to its declared
 * settings. The storage counterpart of `npm run db`, which does the same for
 * the tables.
 */
import { bucket } from "../shared/storage/bucket";
import {
  BUCKET_SETTINGS,
  matchesBucketSettings,
} from "../shared/storage/schema";

for (const [name, declared] of Object.entries(BUCKET_SETTINGS)) {
  const live = await bucket.readSettings(name);

  if (!live) {
    await bucket.create(name, declared);
    console.log(`Created bucket "${name}":`, declared);
  } else if (matchesBucketSettings(live, declared)) {
    console.log(`Bucket "${name}" already matches the schema`);
    console.log("  compared:", declared);
  } else {
    await bucket.updateSettings(name, declared);
    console.log(`Updated bucket "${name}"`);
    console.log("  from:", live);
    console.log("  to:  ", declared);
  }
}
