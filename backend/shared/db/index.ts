import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { getBaseEnv } from "../env";
import * as schema from "./schema";

const databaseUrl = getBaseEnv().DATABASE_URL;

// Supabase's transaction pooler (:6543) can run each query on a different
// server connection, so a statement prepared on one may be missing on the next.
// Every query here is prepared, so only session mode (:5432) is supported.
const TRANSACTION_POOLER_PORT = "6543";
if (new URL(databaseUrl).port === TRANSACTION_POOLER_PORT) {
  throw new Error(
    `DATABASE_URL points at Supabase's transaction pooler (:${TRANSACTION_POOLER_PORT}), which breaks prepared statements. Use the session pooler (:5432).`,
  );
}

const client = postgres(databaseUrl, { fetch_types: false });

// drizzle calls client.unsafe(query, params) without options, and postgres.js
// defaults unsafe() to prepare: false no matter how the client is configured.
// Unprepared parameterized queries cost two round trips instead of one.
const preparingClient = new Proxy(client, {
  get(target, property, receiver) {
    if (property !== "unsafe") return Reflect.get(target, property, receiver);
    const unsafe: typeof target.unsafe = (query, parameters, options) =>
      target.unsafe(query, parameters, { prepare: true, ...options });
    return unsafe;
  },
});

export const db = drizzle(preparingClient, { schema });

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
