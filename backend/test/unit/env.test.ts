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

describe("apiEnvSchema", () => {
  it("accepts valid api env", () => {
    const result = apiEnvSchema.safeParse({
      ...validBase,
      SESSION_SECRET: "a".repeat(32),
      WORKOS_API_KEY: "sk_test",
      WORKOS_CLIENT_ID: "client_test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects SESSION_SECRET shorter than 32 chars", () => {
    const result = apiEnvSchema.safeParse({
      ...validBase,
      SESSION_SECRET: "a".repeat(31),
      WORKOS_API_KEY: "sk_test",
      WORKOS_CLIENT_ID: "client_test",
    });
  });
});

describe("workerEnvSchema", () => {
  it("accepts valid worker env", () => {
    const result = workerEnvSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});
