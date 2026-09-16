const uploadFile = "uploadFile";
const uploadId = "uploadId";
const fileName = "fileName";
const audioSource = "audioSource";
const chosenModelId = "chosenModelId";
const transcriptModelId = "transcriptModelId";
const youtubeUrl = "youtubeUrl";
const useCaptionsIfAvailable = "useCaptionsIfAvailable";

export const CTX_KEYS = {
  userId: "userId",
  imageUploadId: "imageUploadId",
  audioUploadId: "audioUploadId",
  conversationId: "conversationId",
  messageId: "messageId",

  limit: "limit",
  cursor: "cursor",
  status: "status",
  q: "q",

  conversationTitle: "conversationTitle",

  messageContent: "messageContent",
  messageAttachmentsIds: "attachments",
  lastMessageId: "lastMessageId",

  uploadFile,
  fileName,
  chosenModelId,
  transcriptModelId,
  audioSource,
  youtubeUrl,
  useCaptionsIfAvailable,
} as const;

export const FORM_KEYS = {
  uploadFile,
  uploadId,
  fileName,
  transcriptModelId,
  audioSource,
} as const;

export const COOKIE_KEYS = {
  session: "session",
} as const;
