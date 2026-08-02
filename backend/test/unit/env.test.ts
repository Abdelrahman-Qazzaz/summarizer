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
  CLIENT_URL: "http://localhost:5173",
  API_BASE_URL: "http://localhost:3001",
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

  it.each(["CLIENT_URL", "API_BASE_URL"] as const)(
    "requires %s rather than defaulting to localhost",
    (key) => {
      const { [key]: _omitted, ...withoutUrl } = validApi;
      const result = apiEnvSchema.safeParse(withoutUrl);
      expect(result.success).toBe(false);
    },
  );
});

describe("workerEnvSchema", () => {
  it("accepts valid worker env", () => {
    const result = workerEnvSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("requires the same base vars the API does", () => {
    const { MQ_URL: _omitted, ...withoutMq } = validBase;
    const result = workerEnvSchema.safeParse(withoutMq);
    expect(result.success).toBe(false);
  });
});
