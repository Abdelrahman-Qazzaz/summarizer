import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
  // RabbitMQ redelivers an unACKed message after its consumer connection closes,
  // but that worker may still finish its AI call after a network split. Every
  // claim replaces this fencing token, and terminal writes must still own it so
  // a disconnected worker cannot commit after its replacement has taken over.
  claimToken: uuid("claim_token"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  userId: text("user_id")
    .notNull()
    .references(() => users.id),

  // Model used to transcribe the audio. Null falls back to the default
  transcriptionModelId: text("transcription_model_id"),
}, (table) => [
  // Matches findUserJobsPage: owner filter + the (created_at, upload_id) keyset
  // ordering, so a page is served from the index without a scan-and-sort.
  index("audio_jobs_user_created_upload_idx").on(
    table.userId,
    table.createdAt,
    table.uploadId,
  ),
]);

/**
 * The transcript text a completed job produced, out of the job row so it isn't
 * pulled by the job list. A row exists only while a valid transcript does — the
 * worker upserts it on completion, a re-run deletes it — so its presence means
 * "ready". `charCount` lets a chat turn be budgeted without reading the body.
 */
export const TranscriptContents = pgTable("transcript_contents", {
  // The audio job this transcript belongs to (1:1).
  uploadId: text("upload_id")
    .primaryKey()
    .references(() => AudioTranscriptionJobs.uploadId, { onDelete: "cascade" }),
  content: text("content").notNull(),
  charCount: integer("char_count").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
}, (table) => [
  // resolveMessageImages / findMessageImageUploadIds look images up by the
  // message they hang off; message_id is highly selective (few per message).
  index("image_uploads_message_idx").on(table.messageId),
]);

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

  // Fingerprint of the context the last reply was generated against. Written
  // with the (non-blocking) turn writes and echoed by the client on its next
  // turn, so a drift between the two is visible. Null until the first turn.
  contextHash: text("context_hash"),

  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
}, (table) => [
  // findUserConversations: owner filter + the (updated_at, id) ordering the
  // list is served in.
  index("conversations_user_updated_idx").on(
    table.userId,
    table.updatedAt,
    table.id,
  ),
]);

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
}, (table) => [
  // The busiest read in the app: findConversationMessages (asc) and
  // findRecentMessagesWithContext (desc) both filter by conversation and order
  // by (created_at, id), fully covered here so neither scans nor sorts.
  index("chat_messages_conversation_created_idx").on(
    table.conversationId,
    table.createdAt,
    table.id,
  ),
]);

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
