import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
  schemaName: `attachment_test_${Date.now()}`,
  client: null as Sql | null,
  deleteFromBucket: vi.fn(),
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

vi.mock("../../shared/bucket", () => ({
  IMAGE_URL_TTL_SECONDS: 604800,
  createSignedUrls: vi.fn(),
  deleteFromBucket: testState.deleteFromBucket,
}));

import {
  AttachmentTurnReservations,
  Attachments,
  ChatMessageAttachmentLinks,
  Conversations,
  db,
  users,
} from "../../shared/db";
import {
  deleteOwnedUnlinkedUnreservedAttachments,
  unclaimAttachments,
  claimAttachments,
} from "../../shared/data/attachments.data";
import { deleteOwnedUnlinkedUnreservedImageAttachment } from "../../shared/data/images.data";
import { persistChatTurn } from "../../shared/data/messages.data";

const userId = "reservation-owner";
const imageUploadId = randomUUID();
const audioUploadId = randomUUID();
const conversationId = randomUUID();
const claimToken = randomUUID();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function waitForBlockedQuery() {
  await vi.waitFor(async () => {
    const blocked = await db.execute(sql`
      select 1 from pg_stat_activity
      where application_name = ${testState.schemaName} and wait_event_type = 'Lock'
    `);
    expect(blocked.length).toBeGreaterThan(0);
  });
}

// ATTACHMENT_TEST_DATABASE_URL enables these tests; each run creates and drops its own schema.
describe.skipIf(!testState.databaseUrl)(
  "attachment reservations in PostgreSQL",
  () => {
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
      await db.execute(
        sql.raw(`drop schema "${testState.schemaName}" cascade`),
      );
      await testState.client!.end();
    });

    beforeEach(async () => {
      testState.deleteFromBucket.mockReset().mockResolvedValue(undefined);
      await db.execute(sql`truncate ${users} cascade`);
      await db.insert(users).values({ id: userId });
      await db.insert(Conversations).values({
        id: conversationId,
        userId,
        activeTurnClaimToken: claimToken,
        activeTurnClaimedAt: new Date(),
      });
      await db.insert(Attachments).values([
        {
          attachmentId: imageUploadId,
          userId,
          kind: "image",
          fileName: "image.png",
          sizeBytes: 10,
        },
        {
          attachmentId: audioUploadId,
          userId,
          kind: "audio",
          fileName: "audio.mp3",
          sizeBytes: 20,
        },
      ]);
    });

    it("reserves all requested attachments or none, with ownership checks", async () => {
      expect(
        await claimAttachments(userId, [imageUploadId, "missing"], claimToken),
      ).toBe(false);
      expect(
        await claimAttachments("another-user", [imageUploadId], claimToken),
      ).toBe(false);
      expect(await db.select().from(AttachmentTurnReservations)).toEqual([]);
    });

    it("deduplicates IDs and retains the reservation expiry", async () => {
      const startedAt = Date.now();
      expect(
        await claimAttachments(
          userId,
          [imageUploadId, imageUploadId],
          claimToken,
        ),
      ).toBe(true);
      const rows = await db.select().from(AttachmentTurnReservations);
      expect(rows).toHaveLength(1);
      expect(rows[0].expiresAt.getTime()).toBeGreaterThanOrEqual(
        startedAt + 600_000,
      );
      expect(rows[0].claimToken).toBe(claimToken);
    });

    it("allows concurrent reservations with reversed input order", async () => {
      expect(
        await Promise.all([
          claimAttachments(
            userId,
            [imageUploadId, audioUploadId],
            randomUUID(),
          ),
          claimAttachments(
            userId,
            [audioUploadId, imageUploadId],
            randomUUID(),
          ),
        ]),
      ).toEqual([true, true]);
      expect(await db.select().from(AttachmentTurnReservations)).toHaveLength(
        4,
      );
    });

    it("protects images and transcripts until the completed turn links them", async () => {
      expect(
        await claimAttachments(
          userId,
          [imageUploadId, audioUploadId],
          claimToken,
        ),
      ).toBe(true);
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).not.toHaveBeenCalled();
      expect(
        await deleteOwnedUnlinkedUnreservedAttachments({
          userId,
          attachmentIds: [audioUploadId],
          kind: "audio",
        }),
      ).toEqual([]);

      await persistChatTurn({
        userId,
        conversationId,
        content: "Summarize",
        attachmentIds: [imageUploadId, audioUploadId],
        chosenModelId: "test-model",
        assistantContent: "Summary",
        contextWindowMessageCount: 2,
        claimToken,
      });
      expect(await db.select().from(ChatMessageAttachmentLinks)).toHaveLength(
        2,
      );
      expect(await db.select().from(AttachmentTurnReservations)).toEqual([]);
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).not.toHaveBeenCalled();
    });

    it("releases only the failed turn's reservation when attachments are shared", async () => {
      const otherClaimToken = randomUUID();
      await claimAttachments(userId, [imageUploadId], claimToken);
      await claimAttachments(userId, [imageUploadId], otherClaimToken);
      await unclaimAttachments(claimToken);
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).not.toHaveBeenCalled();
      await unclaimAttachments(otherClaimToken);
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).toHaveBeenCalledWith(userId, [
        { kind: "image", uploadId: imageUploadId },
      ]);
    });

    it("keeps reservations when persistence rolls back", async () => {
      await claimAttachments(userId, [imageUploadId], claimToken);
      await db
        .update(Conversations)
        .set({ activeTurnClaimToken: randomUUID() });

      await expect(
        persistChatTurn({
          userId,
          conversationId,
          content: "Describe",
          attachmentIds: [imageUploadId],
          chosenModelId: "test-model",
          assistantContent: "Description",
          contextWindowMessageCount: 2,
          claimToken,
        }),
      ).rejects.toThrow("Conversation turn claim was lost");

      expect(await db.select().from(ChatMessageAttachmentLinks)).toEqual([]);
      expect(await db.select().from(AttachmentTurnReservations)).toHaveLength(
        1,
      );
      await unclaimAttachments(claimToken);
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).toHaveBeenCalledWith(userId, [
        { kind: "image", uploadId: imageUploadId },
      ]);
    });

    it("protects an expired reservation while its conversation claim still exists", async () => {
      await claimAttachments(userId, [imageUploadId], claimToken);
      await db
        .update(AttachmentTurnReservations)
        .set({ expiresAt: new Date(0) });
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).not.toHaveBeenCalled();

      await db.update(Conversations).set({ activeTurnClaimToken: null });
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).toHaveBeenCalledWith(userId, [
        { kind: "image", uploadId: imageUploadId },
      ]);
    });

    it("rolls back a failed bucket deletion so the attachment can be retried", async () => {
      testState.deleteFromBucket.mockRejectedValueOnce(
        new Error("storage unavailable"),
      );
      await expect(
        deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId),
      ).rejects.toThrow("storage unavailable");
      expect(
        await db
          .select()
          .from(Attachments)
          .where(eq(Attachments.attachmentId, imageUploadId)),
      ).toHaveLength(1);
      await deleteOwnedUnlinkedUnreservedImageAttachment(userId, imageUploadId);
      expect(testState.deleteFromBucket).toHaveBeenCalledTimes(2);
    });

    it("waits for an ongoing image deletion and rejects reservation if deletion wins", async () => {
      const storageStarted = deferred();
      const finishStorage = deferred();
      testState.deleteFromBucket.mockImplementationOnce(async () => {
        storageStarted.resolve();
        await finishStorage.promise;
      });
      const deletion = deleteOwnedUnlinkedUnreservedImageAttachment(
        userId,
        imageUploadId,
      );
      await storageStarted.promise;
      const reservation = claimAttachments(userId, [imageUploadId], claimToken);
      try {
        await waitForBlockedQuery();
      } finally {
        finishStorage.resolve();
      }
      await deletion;
      expect(await reservation).toBe(false);
      expect(await db.select().from(AttachmentTurnReservations)).toEqual([]);
    });

    it("rechecks reservations after a delete waits for the attachment lock", async () => {
      const reservationStarted = deferred();
      const finishReservation = deferred();
      const reservation = db.transaction(async (transaction) => {
        await transaction
          .select()
          .from(Attachments)
          .where(
            and(
              eq(Attachments.userId, userId),
              eq(Attachments.attachmentId, imageUploadId),
            ),
          )
          .for("update");
        await transaction.insert(AttachmentTurnReservations).values({
          attachmentId: imageUploadId,
          claimToken,
          expiresAt: new Date(Date.now() + 60_000),
        });
        reservationStarted.resolve();
        await finishReservation.promise;
      });
      await reservationStarted.promise;
      const deletion = deleteOwnedUnlinkedUnreservedImageAttachment(
        userId,
        imageUploadId,
      );
      try {
        await waitForBlockedQuery();
      } finally {
        finishReservation.resolve();
      }
      await Promise.all([reservation, deletion]);
      expect(testState.deleteFromBucket).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(Attachments)
          .where(eq(Attachments.attachmentId, imageUploadId)),
      ).toHaveLength(1);
    });
  },
);
