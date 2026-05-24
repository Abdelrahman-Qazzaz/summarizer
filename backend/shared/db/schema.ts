import { relations } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pgEnum } from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
]);

/** Speech jobs after audio upload (transcription pipeline). */
export const AudioTranscriptionJobs = pgTable("audio_transcription_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  uploadId: text("upload_id").notNull().unique(),
  source: text("source").notNull(), // 'video' | 'audio'
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  // queued | processing | completed | failed
  transcript: text("transcript"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  userId: text("user_id")
    .notNull()
    .references(() => users.id),
});

export const TextSummarizationJobs = pgTable("text_summarization_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  uploadId: text("upload_id").notNull().unique(),
  fileName: text("file_name").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  summary: text("summary"),
  // queued | processing | completed | failed
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  userId: text("user_id")
    .notNull()
    .references(() => users.id),
});

export const users = pgTable("users", {
  // WorkOS user id (eg "user_01...")
  id: text("id").primaryKey(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
