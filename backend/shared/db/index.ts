import { drizzle } from "drizzle-orm/neon-http";
import { sql as drizzleSql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { getBaseEnv } from "../env";
import * as schema from "./schema";

const sql = neon(getBaseEnv().DATABASE_URL);

export const db = drizzle(sql, { schema });

/** Startup health check: fails if the database is unreachable. */
export async function pingDb(): Promise<void> {
  await db.execute(drizzleSql`select 1`);
}

export * from "./schema";
