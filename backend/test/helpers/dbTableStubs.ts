/**
 * Stand-ins for the drizzle tables, for suites that mock `shared/db` wholesale.
 *
 * Controllers read columns at module scope (their `select()` projections are
 * module-level consts), so a mock missing a table — or a column — fails the
 * whole file at import. Keeping the stubs here means adding a column touches
 * one place instead of every suite that happens to build the app.
 */
export const tableStubs = {
  DEFAULT_CONVERSATION_TITLE: "New conversation",
  users: { id: "id", createdAt: "created_at", updatedAt: "updated_at" },

  AudioTranscriptionJobs: {
    uploadId: "upload_id",
    source: "source",
    fileName: "file_name",
    status: "status",
    error: "error",
    claimToken: "claim_token",
    createdAt: "created_at",
    transcriptModelId: "transcription_model_id",
    transcriptUploadId: "transcript_upload_id",
    userId: "user_id",
  },

  ImageUploads: {
    uploadId: "upload_id",
    fileName: "file_name",
    mimeType: "mime_type",
    sizeBytes: "size_bytes",
    signedUrl: "signed_url",
    signedUrlExpiresAt: "signed_url_expires_at",
    messageId: "message_id",
    createdAt: "created_at",
    userId: "user_id",
  },

  Conversations: {
    id: "id",
    title: "title",
    createdAt: "created_at",
    updatedAt: "updated_at",
    lastMessageId: "last_message_id",
    activeTurnClaimToken: "active_turn_claim_token",
    userId: "user_id",
  },

  ChatMessages: {
    id: "id",
    role: "role",
    content: "content",
    chosenModelId: "chosen_model_id",
    conversationId: "conversation_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
    userId: "user_id",
  },

  ChatMessageTranscriptions: {
    messageId: "message_id",
    audioUploadId: "audio_upload_id",
    position: "position",
  },

  TranscriptContents: {
    uploadId: "upload_id",
    content: "content",
    charCount: "char_count",
    title: "title",
    userId: "user_id",
  },

  jobStatusEnum: {
    enumValues: ["queued", "processing", "completed", "failed"],
  },
};
