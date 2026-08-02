import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pgEnum } from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
] as const);

/** Speech jobs after audio upload (transcription pipeline). */
export const AudioTranscriptionJobs = pgTable("audio_transcription_jobs", {
  uploadId: text("upload_id").notNull().primaryKey(),
  source: text("source").notNull(), // 'video' | 'audio' | 'youtube'
  // Origin URL for 'youtube' jobs; null for direct uploads. Stored for history
  // display and to enable transcript caching by video id later.
  YT_sourceUrl: text("YT_source_url"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
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

  // Model used to transcribe the audio. Null falls back to the worker default
  // (DEFAULT_MODELS.TRANSCRIBE); a transcribe re-run overwrites it.
  transcriptionModelId: text("transcription_model_id"),

  // Bucket key of the transcript, written once transcription completes. The
  // audio itself lives at this row's own uploadId, so the transcript needs a
  // key of its own. Null until then, and on a job that never got that far.
  transcriptUploadId: text("transcript_upload_id"),
});

export const ImageUploads = pgTable("image_uploads", {
  uploadId: text("upload_id").notNull().primaryKey(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  // Signed once at upload — while the user is still typing — so sending a
  // message never signs. Nullable: rows predating this, and any kind of upload
  // that isn't fetched by a third party, simply have none.
  signedUrl: text("signed_url"),
  signedUrlExpiresAt: timestamp("signed_url_expires_at", {
    withTimezone: true,
  }),

  // The chat message this image was sent with. Null while the image is only
  // uploaded — it is stored the moment it's dropped in, which is before the
  // message it belongs to exists (and it may never be sent at all).
  messageId: uuid("message_id").references(() => ChatMessages.id, {
    onDelete: "cascade",
  }),

  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

/** Chat conversations owned by a user. */
export const Conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New conversation"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"] as const);

export const ChatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Which side of the chat wrote this row — mirrors the chat-completion API's
  // turn roles so history can be replayed to the model as-is.
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  // Model that produced an assistant message; null for user messages.
  chosenModelId: text("chosen_model_id"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => Conversations.id, { onDelete: "cascade" }),

  // A transcription job whose transcript was sent with this turn. The text
  // itself stays in the bucket — this is how one prompt carries a body of
  // arbitrary length without it living in `content`.
  // `set null` rather than `cascade`: deleting a transcription job must not
  // take the conversation that discussed it along with it.
  audioUploadId: text("audio_upload_id").references(
    () => AudioTranscriptionJobs.uploadId,
    { onDelete: "set null" },
  ),

  // could be useful for future "shared chat" feature.
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
