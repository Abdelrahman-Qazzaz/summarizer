import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
export const AudioTranscriptionJobs = pgTable(
  "audio_transcription_jobs",
  {
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
    transcriptModelId: text("transcription_model_id"),
  },
  (table) => [
    // Matches findUserJobsPage: owner filter + the (created_at, upload_id) keyset
    // ordering, so a page is served from the index without a scan-and-sort.
    index("audio_jobs_user_created_upload_idx").on(
      table.userId,
      table.createdAt,
      table.uploadId,
    ),
  ],
);

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

  title: text("title").notNull(),
});

export const ImageUploads = pgTable(
  "image_uploads",
  {
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
  },
  (table) => [
    // resolveMessageImages / findMessageImageUploadIds look images up by the
    // message they hang off; message_id is highly selective (few per message).
    index("image_uploads_message_idx").on(table.messageId),
  ],
);

export const DEFAULT_CONVERSATION_TITLE = "New conversation";

/** Chat conversations owned by a user. */
export const Conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(DEFAULT_CONVERSATION_TITLE),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    lastMessageId: uuid("last_message_id"),
    activeTurnClaimToken: uuid("active_turn_claim_token"),
    // When the active turn was claimed. Without it a claim is only ever
    // cleared by a clean release, so a process that dies mid-turn — an
    // ordinary deploy — leaves the conversation answering 409 forever. The
    // claim is treated as expired past CLAIM_LEASE_MS.
    activeTurnClaimedAt: timestamp("active_turn_claimed_at", {
      withTimezone: true,
    }),

    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    // findUserConversations: owner filter + the (updated_at, id) ordering the
    // list is served in.
    index("conversations_user_updated_idx").on(
      table.userId,
      table.updatedAt,
      table.id,
    ),
  ],
);

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"] as const);

export const ChatMessages = pgTable(
  "chat_messages",
  {
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
  },
  (table) => [
    // The busiest read in the app: findConversationMessages (asc) and
    // findRecentMessagesWithContext (desc) both filter by conversation and order
    // by (created_at, role, id), fully covered here so neither scans nor sorts.
    index("chat_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
      table.role,
      table.id,
    ),
  ],
);

export const ChatMessageTranscriptions = pgTable(
  "chat_message_transcriptions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => ChatMessages.id, { onDelete: "cascade" }),
    audioUploadId: text("audio_upload_id")
      .notNull()
      .references(() => AudioTranscriptionJobs.uploadId, {
        onDelete: "cascade",
      }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.audioUploadId],
    }),
    uniqueIndex("chat_message_transcriptions_message_position_idx").on(
      table.messageId,
      table.position,
    ),
    index("chat_message_transcriptions_audio_upload_idx").on(
      table.audioUploadId,
    ),
  ],
);

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
