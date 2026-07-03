import "dotenv/config";
import { z } from "zod";

function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  label: string,
): z.infer<S> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error(`Invalid environment variables (${label}):`);
    for (const [key, errors] of Object.entries(
      result.error.flatten().fieldErrors,
    )) {
      console.error(`  ${key}: ${errors?.join(", ") ?? "invalid"}`);
    }
    process.exit(1);
  }
  return result.data;
}

const nodeEnvSchema = z
  .enum(["development", "production", "test"])
  .default("development");

/** Shared by API, worker, and Drizzle. */
export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MQ_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  NODE_ENV: nodeEnvSchema,
});

export const apiEnvSchema = baseEnvSchema.extend({
  SESSION_SECRET: z.string().min(32),
  WORKOS_API_KEY: z.string().min(1),
  WORKOS_CLIENT_ID: z.string().min(1),
  CLIENT_URL: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().int().positive().default(3001),
  WS_PORT: z.coerce.number().int().positive().default(4000),
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), {
      message: "UPSTASH_REDIS_REST_URL must use HTTPS",
    }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

/**
 * Which queue consumers a worker process attaches. Run the same image with
 * `transcribe` and `summarize` to scale the two pools independently; `all`
 * (the default) runs both in one process, which keeps local dev a single
 * process.
 */
const workerRoleSchema = z
  .enum(["transcribe", "summarize", "all"])
  .default("all");

export const workerEnvSchema = baseEnvSchema.extend({
  WORKER_ROLE: workerRoleSchema,
});

export const drizzleEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type WorkerRole = z.infer<typeof workerRoleSchema>;

/** For `drizzle-kit` only — does not require MQ, WorkOS, etc. */
export const drizzleEnv = parseEnv(drizzleEnvSchema, "drizzle");

let cachedBaseEnv: BaseEnv | undefined;
export function getBaseEnv(): BaseEnv {
  cachedBaseEnv ??= parseEnv(baseEnvSchema, "base");
  return cachedBaseEnv;
}

let cachedApiEnv: ApiEnv | undefined;
export function getApiEnv(): ApiEnv {
  cachedApiEnv ??= parseEnv(apiEnvSchema, "api");
  return cachedApiEnv;
}

let cachedWorkerEnv: WorkerEnv | undefined;
export function getWorkerEnv(): WorkerEnv {
  cachedWorkerEnv ??= parseEnv(workerEnvSchema, "worker");
  return cachedWorkerEnv;
}
