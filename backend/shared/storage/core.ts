/**
 * What bucket.ts and sign.ts share: the client and the object layout.
 * Internal to storage/; import bucket or sign instead.
 */
import { createClient } from "@supabase/supabase-js";
import { getBaseEnv } from "../env";
import { KINDS, type StoredObject, type StoredObjectKind } from "./schema";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getBaseEnv();
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * The single handle every object operation (upload/download/remove/sign) goes
 * through, so `supabase.storage` is named in one place and each kind's bucket
 * comes from KINDS. (ping uses the bucket-management API `getBucket`, not this
 * handle.)
 */
export function storage(kind: StoredObjectKind) {
  return supabase.storage.from(KINDS[kind].bucket);
}

/**
 * Storage key `<userId>/<folder>/<uploadId>`. Both parts are structural: every
 * operation names the owner and the kind, so a wrong user or a wrong kind
 * yields a path that doesn't exist. The owner is what makes the id-keyed
 * functions below safe to call with untrusted ids; the kind is what stops an
 * upload minted as one kind from being confirmed as another. (The
 * youtube-fetcher builds the same key; keep them in sync.)
 */
export function objectPath(userId: string, { kind, uploadId }: StoredObject) {
  return `${userId}/${KINDS[kind].folder}/${uploadId}`;
}
