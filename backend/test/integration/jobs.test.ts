import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Sql } from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const testState = vi.hoisted(() => ({
  databaseUrl: process.env.ATTACHMENT_TEST_DATABASE_URL,
  schemaName: `jobs_test_${Date.now()}`,
  client: null as Sql | null,
}));

vi.mock("../../shared/db", async () => {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const schema = await import("../../shared/db/schema");
  const client = postgres(
    testState.databaseUrl ?? "postgres://localhost/unused",
    {
      max: 5,
      connection: {
        search_path: testState.schemaName,
        application_name: testState.schemaName,
      },
      onnotice: () => {},
    },
  );
  testState.client = client;
  return { ...schema, db: drizzle(client, { schema }) };
});

import { AudioTranscriptionJobs, db, users } from "../../shared/db";
import { jobs } from "../../shared/data/jobs.data";

const userId = "jobs-owner";

async function createJob() {
  const audioUploadId = randomUUID();
  await jobs.createAudioJob({
    audioUploadId,
    captionUploadId: null,
    userId,
    source: "youtube",
    fileName: "YouTube audio",
    mimeType: null,
    sizeBytes: 0,
    transcriptModelId: "nova-3-general",
  });
  return audioUploadId;
}

async function readJob(audioUploadId: string) {
  const [row] = await db
    .select({
      status: AudioTranscriptionJobs.status,
      claimToken: AudioTranscriptionJobs.claimToken,
      error: AudioTranscriptionJobs.error,
    })
    .from(AudioTranscriptionJobs)
    .where(eq(AudioTranscriptionJobs.audioUploadId, audioUploadId));
  return row;
}

// ATTACHMENT_TEST_DATABASE_URL enables these tests; each run creates and drops its own schema.
describe.skipIf(!testState.databaseUrl)("audio jobs in PostgreSQL", () => {
  beforeAll(async () => {
    await db.execute(sql.raw(`create schema "${testState.schemaName}"`));
    const schemaSql = execFileSync(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "export",
        "--dialect",
        "postgresql",
        "--schema",
        "./shared/db/schema.ts",
      ],
      { encoding: "utf8" },
    ).replaceAll('"public"', `"${testState.schemaName}"`);
    await testState.client!.unsafe(schemaSql);
  });

  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${testState.schemaName}" cascade`));
    await testState.client!.end();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate ${users} cascade`);
    await db.insert(users).values({ id: userId });
  });

  describe("failAudioJobById", () => {
    it("fails a queued job with the reported error", async () => {
      const audioUploadId = await createJob();

      await jobs.failAudioJobById(audioUploadId, "fetch failed");

      expect(await readJob(audioUploadId)).toMatchObject({
        status: "failed",
        error: "fetch failed",
      });
    });

    it("fails a job a worker is processing", async () => {
      const audioUploadId = await createJob();
      await jobs.claimAudioJob(audioUploadId);

      await jobs.failAudioJobById(audioUploadId, "fetch failed");

      expect(await readJob(audioUploadId)).toMatchObject({ status: "failed" });
    });

    it("leaves a completed job completed", async () => {
      const audioUploadId = await createJob();
      const claimed = await jobs.claimAudioJob(audioUploadId);
      await jobs.completeAudioJob(audioUploadId, claimed!.claimToken);

      await jobs.failAudioJobById(audioUploadId, "late fetch failure");

      expect(await readJob(audioUploadId)).toMatchObject({
        status: "completed",
        error: null,
      });
    });
  });
});
