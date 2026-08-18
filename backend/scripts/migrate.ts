/**
 * Applies pending migrations, then exits. This is the deploy step — the thing
 * that runs once before the API and worker start, not on every process boot.
 *
 * It opens its own single connection rather than reusing shared/db: this is a
 * one-shot process that has to exit, and the shared pool is never closed.
 * Drizzle takes a lock while migrating, so several replicas racing to start is
 * safe. It reads only DATABASE_URL, so the deploy step does not need the
 * application's other secrets to run DDL.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzleEnv } from "../shared/env";
import { MIGRATIONS_FOLDER } from "./migrations";

const client = postgres(drizzleEnv.DATABASE_URL, {
  max: 1,
  prepare: false,
});

try {
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migrations applied");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
