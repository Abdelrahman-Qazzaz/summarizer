import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { getBaseEnv } from "../env";
import * as schema from "./schema";

// Supabase Postgres. `prepare: false` keeps this compatible with Supabase's
// transaction pooler (pgbouncer); it's harmless on a direct connection.
const client = postgres(getBaseEnv().DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });

/** Startup health check: fails if the database is unreachable. */
export async function pingDb(): Promise<void> {
  await db.execute(drizzleSql`select 1`);
}

export * from "./schema";
