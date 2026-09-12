import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { getBaseEnv } from "../env";
import * as schema from "./schema";

// Supabase Postgres. `prepare: false` keeps this compatible with Supabase's
// transaction pooler (pgbouncer); it's harmless on a direct connection.
const connectionOptions = {
  prepare: false,
  fetch_types: false,
} as const;
const client = postgres(getBaseEnv().DATABASE_URL, connectionOptions);

export const db = drizzle(client, { schema });

/**
 * A query runner that is either the pool (`db`) or an open transaction. Write
 * helpers take one so several can be composed into a single atomic transaction;
 * it defaults to `db`, so a standalone call is unaffected.
 */
export type Executor =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const DATABASE_CONNECTION_COUNT_TO_WARM = 5;

/** Startup health check: fails if the database is unreachable. */
export async function pingDb(): Promise<void> {
  await Promise.all(
    Array.from({ length: DATABASE_CONNECTION_COUNT_TO_WARM }, () =>
      db.execute(drizzleSql`select 1`),
    ),
  );
}

export * from "./schema";
