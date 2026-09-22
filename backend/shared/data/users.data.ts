import { db, users as Users } from "../db";

/**
 * First login creates the row; every later one is a no-op. The auth provider
 * owns identity, so there is nothing to update here.
 */
async function ensureUser(userId: string) {
  await db.insert(Users).values({ id: userId }).onConflictDoNothing();
}

export const users = {
  ensureUser,
};
