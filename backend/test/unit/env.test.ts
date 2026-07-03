import { describe, it, expect } from "vitest";
import { apiEnvSchema, workerEnvSchema } from "../../shared/env";

const validBase = {
  DATABASE_URL: "postgres://localhost:5432/test",
  MQ_URL: "amqp://localhost",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  OPENROUTER_API_KEY: "test-key",
  NODE_ENV: "test" as const,
};

const validUpstash = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
};

const validApi = {
  ...validBase,
  ...validUpstash,
  SESSION_SECRET: "a".repeat(32),
  WORKOS_API_KEY: "sk_test",
  WORKOS_CLIENT_ID: "client_test",
};

describe("apiEnvSchema", () => {
  it("accepts valid api env", () => {
    const result = apiEnvSchema.safeParse(validApi);
    expect(result.success).toBe(true);
  });

  it("rejects SESSION_SECRET shorter than 32 chars", () => {
    const result = apiEnvSchema.safeParse({
      ...validApi,
      SESSION_SECRET: "a".repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty UPSTASH_REDIS_REST_TOKEN", () => {
    const result = apiEnvSchema.safeParse({
      ...validApi,
      UPSTASH_REDIS_REST_TOKEN: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-HTTPS UPSTASH_REDIS_REST_URL", () => {
    const result = apiEnvSchema.safeParse({
      ...validApi,
      UPSTASH_REDIS_REST_URL: "http://example.upstash.io",
    });
    expect(result.success).toBe(false);
  });
});

describe("workerEnvSchema", () => {
  it("accepts valid worker env", () => {
    const result = workerEnvSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("defaults WORKER_ROLE to all", () => {
    const result = workerEnvSchema.safeParse(validBase);
    expect(result.success && result.data.WORKER_ROLE).toBe("all");
  });

  it("accepts an explicit WORKER_ROLE", () => {
    const result = workerEnvSchema.safeParse({
      ...validBase,
      WORKER_ROLE: "transcribe",
    });
    expect(result.success && result.data.WORKER_ROLE).toBe("transcribe");
  });

  it("rejects an unknown WORKER_ROLE", () => {
    const result = workerEnvSchema.safeParse({
      ...validBase,
      WORKER_ROLE: "bogus",
    });
    expect(result.success).toBe(false);
  });
});
