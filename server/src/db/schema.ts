import {
  bigint,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Speech jobs after audio upload (transcription pipeline). */
export const transcriptionJobs = pgTable("transcription_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  uploadId: text("upload_id").notNull().unique(),
  source: text("source").notNull(), // 'video' | 'audio'
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: text("status").notNull().default("queued"),
  // queued | processing | completed | failed
  transcript: text("transcript"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type TranscriptionJob = typeof transcriptionJobs.$inferSelect;
export type NewTranscriptionJob = typeof transcriptionJobs.$inferInsert;
