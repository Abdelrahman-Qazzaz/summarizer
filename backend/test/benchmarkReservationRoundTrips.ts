import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import postgres from "postgres";
import { getBaseEnv } from "../shared/env";
import {
  Attachments,
  AttachmentTurnReservations,
  db,
  pingDb,
  users,
} from "../shared/db";
import {
  reserveAttachments,
  releaseAttachmentReservations,
} from "../shared/data/attachments.data";
import { CLAIM_LEASE_MS } from "../shared/data/conversations.data";

const userId = `perf-reservation-${randomUUID()}`;
const attachmentIds = [randomUUID(), randomUUID()];
const samples: { operation: string; durationMs: number }[] = [];
async function measure(operation: string, run: () => Promise<unknown>) {
  const startedAt = performance.now();
  await run();
  samples.push({
    operation,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  });
}
const client = postgres(getBaseEnv().DATABASE_URL, {
  prepare: false,
  fetch_types: false,
});
try {
  await client`select 1`;
  for (let iteration = 0; iteration < 3; iteration++) {
    await measure("warm unparameterized query", async () => {
      await client`select 1`;
    });
    await measure("warm parameterized query", async () => {
      await client`select ${iteration}::integer`;
    });
  }
  await pingDb();
  await db.insert(users).values({ id: userId });
  await db.insert(Attachments).values(
    attachmentIds.map((attachmentId) => ({
      attachmentId,
      userId,
      kind: "image" as const,
      fileName: "benchmark.png",
      sizeBytes: 1,
    })),
  );
  for (let iteration = 0; iteration < 6; iteration++) {
    for (const operation of iteration % 2 === 0
      ? ["transaction", "single statement"]
      : ["single statement", "transaction"]) {
      const claimToken = randomUUID();
      await measure(operation, async () => {
        if (operation === "single statement") {
          assert(await reserveAttachments(userId, attachmentIds, claimToken));
          return;
        }
        await db.transaction(async (transaction) => {
          const rows = await transaction
            .select({ attachmentId: Attachments.attachmentId })
            .from(Attachments)
            .where(
              and(
                eq(Attachments.userId, userId),
                inArray(Attachments.attachmentId, attachmentIds),
              ),
            )
            .orderBy(asc(Attachments.attachmentId))
            .for("update");
          assert.equal(rows.length, attachmentIds.length);
          await transaction.insert(AttachmentTurnReservations).values(
            attachmentIds.map((attachmentId) => ({
              attachmentId,
              claimToken,
              expiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
            })),
          );
        });
      });
      const rows = await db
        .select()
        .from(AttachmentTurnReservations)
        .where(eq(AttachmentTurnReservations.claimToken, claimToken));
      assert.equal(rows.length, 2);
      await releaseAttachmentReservations(claimToken);
    }
  }
  const summaries = [...new Set(samples.map((sample) => sample.operation))].map(
    (operation) => {
      const durations = samples
        .filter((sample) => sample.operation === operation)
        .map((sample) => sample.durationMs)
        .sort((a, b) => a - b);
      const middle = Math.floor(durations.length / 2);
      return {
        operation,
        samples: durations.length,
        medianMs:
          durations.length % 2
            ? durations[middle]
            : (durations[middle - 1] + durations[middle]) / 2,
        minMs: durations[0],
        maxMs: durations.at(-1),
      };
    },
  );
  await writeFile(
    "../output/preparation-metrics/reservation-benchmark.json",
    JSON.stringify({ samples, summaries }, null, 2) + "\n",
  );
  console.log(JSON.stringify(summaries));
} finally {
  await db.delete(users).where(eq(users.id, userId));
  const [remaining] = await db.execute<{ count: number }>(
    sql`select count(*)::integer as count from ${Attachments} where ${Attachments.userId} = ${userId}`,
  );
  assert.equal(remaining.count, 0);
  await client.end();
}
process.exit(0);
