const uploadFile = "uploadFile";
const audioSource = "audioSource";
const chosenModelId = "chosenModelId";
const transcriptionModelId = "transcriptionModelId";

export const CTX_KEYS = {
  userId: "userId",
  uploadId: "uploadId",
  limit: "limit",
  cursor: "cursor",
  status: "status",
  kind: "kind",
  q: "q",

  uploadFile,
  chosenModelId,
  transcriptionModelId,
  audioSource,
} as const;

export const FORM_KEYS = {
  uploadFile,
  chosenModelId,
  transcriptionModelId,
  audioSource,
} as const;

export const COOKIE_KEYS = {
  session: "session",
} as const;

export const CACHE_KEYS = {
  openRouterModels: "models:v5",
};
