import "dotenv/config";
import { z } from "zod";

const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";

/**
 * Doppler injects these into every process it wraps, so their absence means
 * the values below came from .env instead. That fallback is legitimate but
 * silent, and a stale .env URL points the app at the wrong host in ways that
 * are painful to trace — so say so loudly, once.
 *
 * Not in production: there the environment comes from the platform and Doppler
 * is never in the picture, so the warning would fire on every boot and mean
 * nothing.
 */
let warnedAboutDopplerFallback = false;
function warnIfNotRunningUnderDoppler(): void {
  if (warnedAboutDopplerFallback) return;
  if (process.env.NODE_ENV === "production") return;
  if (process.env.DOPPLER_PROJECT && process.env.DOPPLER_CONFIG) return;
  warnedAboutDopplerFallback = true;
  console.error(
    `${ANSI_RED}[env] Doppler is not injecting this process — falling back to .env. URLs may point at the wrong host. Start it with \`doppler run -- <command>\`.${ANSI_RESET}`,
  );
}

function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  label: string,
): z.infer<S> {
  warnIfNotRunningUnderDoppler();
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
const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MQ_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  DEEPGRAM_API_KEY: z.string().min(1),
  NODE_ENV: nodeEnvSchema,
});

export const apiEnvSchema = baseEnvSchema.extend({
  SESSION_SECRET: z.string().min(32),
  WORKOS_API_KEY: z.string().min(1),
  WORKOS_CLIENT_ID: z.string().min(1),
  CLIENT_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), {
      message: "UPSTASH_REDIS_REST_URL must use HTTPS",
    }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

/** The worker consumes one queue, so it needs nothing beyond the base env. */
export const workerEnvSchema = baseEnvSchema;

const drizzleEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

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
