export const CACHE_KEYS = {
  openRouterModels: "openRouterModels",
  deepgramTranscribeModels: "deepgramTranscribeModels",
} as const;

export type CacheKey = (typeof CACHE_KEYS)[keyof typeof CACHE_KEYS];
