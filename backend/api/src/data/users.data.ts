import { db, users } from "../../../shared/db";

/**
 * First login creates the row; every later one is a no-op. The auth provider
 * owns identity, so there is nothing to update here.
 */
export async function ensureUser(userId: string) {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
}
