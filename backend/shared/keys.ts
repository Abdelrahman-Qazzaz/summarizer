const uploadFile = "uploadFile";
const audioSource = "audioSource";
const chosenModelId = "chosenModelId";

export const CTX_KEYS = {
  userId: "userId",
  uploadId: "uploadId",

  uploadFile,
  chosenModelId,
  audioSource,
} as const;

export const FORM_KEYS = {
  uploadFile,
  chosenModelId,
  audioSource,
} as const;

export const COOKIE_KEYS = {
  session: "session",
} as const;

export const CACHE_KEYS = {
  openRouterModels: "models:v2",
};
