const uploadFile = "uploadFile";
const audioSource = "audioSource";
const chosenModelId = "chosenModelId";
const transcriptionModelId = "transcriptionModelId";
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
  // Transcription job whose transcript rides along with a chat turn.
  audioUploadId: "audioUploadId",
  // Fingerprint of the context the client's last turn was built on; echoed back
  // so the server can spot drift between the two.
  contextHash: "contextHash",

  uploadFile,
  chosenModelId,
  transcriptionModelId,
  audioSource,
  youtubeUrl,
} as const;

export const FORM_KEYS = {
  uploadFile,
  transcriptionModelId,
  audioSource,
} as const;

export const COOKIE_KEYS = {
  session: "session",
} as const;

export const CACHE_KEYS = {
  openRouterModels: "models:v7",
  deepgramTranscribeModels: "transcribe-models:v1",
};
