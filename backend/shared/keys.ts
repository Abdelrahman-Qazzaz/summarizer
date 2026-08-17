const uploadFile = "uploadFile";
const audioSource = "audioSource";
const chosenModelId = "chosenModelId";
const transcriptModelId = "transcriptModelId";
const youtubeUrl = "youtubeUrl";

export const CTX_KEYS = {
  userId: "userId",
  uploadId: "uploadId",
  conversationId: "conversationId",
  messageId: "messageId",

  limit: "limit",
  cursor: "cursor",
  status: "status",
  q: "q",

  conversationTitle: "conversationTitle",

  messageContent: "messageContent",
  attachmentUploadIds: "attachmentUploadIds",
  audioUploadIds: "audioUploadIds",
  lastMessageId: "lastMessageId",

  uploadFile,
  chosenModelId,
  transcriptModelId,
  audioSource,
  youtubeUrl,
} as const;

export const FORM_KEYS = {
  uploadFile,
  transcriptModelId,
  audioSource,
} as const;

export const COOKIE_KEYS = {
  session: "session",
} as const;
