import { vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://user:password@host.tld/dbname?option=value";
process.env.MQ_URL = "amqp://localhost";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.WORKOS_API_KEY = "sk_test";
process.env.WORKOS_CLIENT_ID = "client_test";
process.env.SESSION_SECRET = "test-session-secret-must-be-32-chars-min";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.PORT = "3001";
process.env.WS_PORT = "4000";
process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

vi.mock("../services/api/src/rateLimit/storage", async () => {
  const { createMockRateLimitStore } = await import(
    "./helpers/rateLimitStoreMock"
  );
  return { createRateLimitStore: createMockRateLimitStore };
});
