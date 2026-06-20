export const CTX_KEYS = {
  userId: "userId",
  chosenModelId: "chosenModelId",
  uploadId: "uploadId",
  uploadFile: "uploadFile",
  audioSource: "audioSource",
} as const;

export const FORM_KEYS = {
  file: "file",
  source: "source",
  model: "chosenModelId",
} as const;

export const COOKIE_KEYS = {
  session: "session",
} as const;

export const CACHE_KEYS = {
  openRouterModels: "models:v1",
};
