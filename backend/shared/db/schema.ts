import { relations } from "drizzle-orm";
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

  // Summarization model for the downstream transcript summary.
  chosenModelId: text("chosen_model_id").notNull(),

  // Model used to transcribe the audio. Null falls back to the worker default
  // (DEFAULT_MODELS.TRANSCRIBE); a transcribe re-run overwrites it.
  transcriptionModelId: text("transcription_model_id"),
});

export const TextSummarizationJobs = pgTable("text_summarization_jobs", {
  uploadId: text("upload_id").notNull().primaryKey(),
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

  chosenModelId: text("chosen_model_id").notNull(),

  // Set when this summary was derived from an audio upload. Null for jobs the
  // user uploaded as text directly. Lets an audio job expose its summary +
  // summaryStatus, and lets the history list hide these derived rows.
  audioUploadId: text("audio_upload_id").references(
    () => AudioTranscriptionJobs.uploadId,
    { onDelete: "cascade" },
  ),
});

/** Standalone image uploads — storage only, no processing job. Referenced by
 * uploadId from ChatAttachments once a user sends a message with one attached. */
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

  // could be useful for future "shared chat" feature.
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

//TODO: add 'transcripts' as attachmentKind.
export const attachmentKindEnum = pgEnum("attachment_kind", ["image"] as const);

/**
 * Items referenced/attached to a chat message (e.g. an image dropped into the
 * chat before sending). One message can have several rows. Deliberately has no
 * conversationId — a message already scopes to a conversation, and an
 * attachment only ever belongs to one message.
 */
export const ChatAttachments = pgTable("chat_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: attachmentKindEnum("kind").notNull(),
  // Id of the row in the kind-specific table (e.g. ImageUploads.uploadId).
  uploadId: text("upload_id").notNull(),
  // Denormalized from the source upload row so the chat UI can render a chip
  // without joining across every kind-specific table.
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  messageId: uuid("message_id")
    .notNull()
    .references(() => ChatMessages.id, { onDelete: "cascade" }),
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
