/**
 * One-off: adopt an existing database into migrations.
 *
 * The schema was created with `drizzle-kit push`, so the tables exist but
 * drizzle has no record of any migration. Running `migrate` against it would
 * try to CREATE TABLE over live data and fail. This records the initial
 * migration as already applied, matching exactly what drizzle's migrator
 * writes: sha256 of the .sql file, and the journal's `when` as created_at.
 * Everything generated later is newer and applies normally.
 *
 * Run once per environment, then never again.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import postgres from "postgres";
import { drizzleEnv } from "../shared/env";
import { MIGRATIONS_FOLDER } from "./migrations";

/** Every table the initial migration creates; all must already be present. */
const EXPECTED_TABLES = [
  "users",
  "audio_transcription_jobs",
  "transcript_contents",
  "image_uploads",
  "conversations",
  "chat_messages",
  "chat_message_transcriptions",
];

type JournalEntry = { tag: string; when: number };

function readJournal(): JournalEntry[] {
  const path = `${MIGRATIONS_FOLDER}/meta/_journal.json`;
  const journal = JSON.parse(fs.readFileSync(path, "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

function hashOf(tag: string): string {
  const sql = fs.readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

const client = postgres(drizzleEnv.DATABASE_URL, { max: 1, prepare: false });

try {
  const entries = readJournal();
  if (entries.length === 0) {
    throw new Error("No migrations to baseline — run db:generate first.");
  }

  // Baselining an empty database would mark the schema as created without
  // creating it, and the failure would surface much later as missing tables.
  const present = await client<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = any(${EXPECTED_TABLES})
  `;
  const missing = EXPECTED_TABLES.filter(
    (table) => !present.some((row) => row.table_name === table),
  );
  if (missing.length > 0) {
    throw new Error(
      `This database is not already migrated — missing: ${missing.join(", ")}.\n` +
        "Run `npm run db:migrate` against it instead; baselining would skip creating these.",
    );
  }

  await client`create schema if not exists drizzle`;
  await client`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;

  const [{ count }] = await client<{ count: string }[]>`
    select count(*)::text as count from drizzle.__drizzle_migrations
  `;
  if (Number(count) > 0) {
    throw new Error(
      `Already baselined: ${count} migration(s) recorded. Nothing to do.`,
    );
  }

  for (const entry of entries) {
    await client`
      insert into drizzle.__drizzle_migrations ("hash", "created_at")
      values (${hashOf(entry.tag)}, ${entry.when})
    `;
    console.log(`Recorded ${entry.tag} as already applied`);
  }
  console.log(
    `Baselined ${entries.length} migration(s). ` +
      "`npm run db:migrate` will now report nothing to apply.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
