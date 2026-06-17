export type RedisCacheOptions = {
  /** Static key or per-request key (e.g. include userId if response varies) */
  key: string;
  ttlSeconds: number;
  prefix?: string; // default "cache:"
};
