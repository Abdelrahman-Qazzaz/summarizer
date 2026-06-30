import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Directory where `createJsonFile` writes when given no absolute path. */
const LOGS_DIR = fileURLToPath(new URL("./logs", import.meta.url));

/**
 * Minimum level to emit. Controlled by `LOG_LEVEL`; defaults to `info` in
 * production and `debug` everywhere else. Read straight from `process.env` so
 * the logger has no dependency on the validated env and is safe to use during
 * bootstrap (env validation, client construction, etc.).
 */
function resolveMinLevel(): LogLevel {
  const fromEnv = process.env.LOG_LEVEL?.toLowerCase();
  if (fromEnv && fromEnv in LEVEL_PRIORITY) return fromEnv as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const MIN_PRIORITY = LEVEL_PRIORITY[resolveMinLevel()];
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function normalizeError(error: unknown): LogContext {
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack };

  return { message: String(error) };
}

const LEVEL_SINK: Record<LogLevel, (line: string) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function format(level: LogLevel, record: LogContext): string {
  if (IS_PRODUCTION) return JSON.stringify(record);

  const { timestamp, message, ...rest } = record;
  const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  const color = LEVEL_COLOR[level];
  return `${color}${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${meta}${RESET}`;
}
interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  /** Logs an error. Pass the caught value as `error` to capture name/stack. */
  error(message: string, error?: unknown, context?: LogContext): void;
  /**
   * Writes `data` as formatted JSON. Relative paths (or no path) resolve into
   * the logger's `logs/` directory; absolute paths are written as given.
   * Defaults to `<guid>.json`. Returns the path written.
   */
  createJsonFile(data: unknown, filePath?: string): Promise<string>;
  /** Returns a logger that merges `context` into every record it emits. */
  child(context: LogContext): Logger;
}

function createLogger(baseContext: LogContext = {}): Logger {
  function emit(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_PRIORITY[level] < MIN_PRIORITY) return;
    const record: LogContext = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseContext,
      ...context,
    };
    LEVEL_SINK[level](format(level, record));
  }
  async function createJsonFile(
    data: unknown,
    filePath?: string,
  ): Promise<string> {
    const name = filePath ?? `${randomUUID()}.json`;
    const path = isAbsolute(name) ? name : join(LOGS_DIR, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), "utf8");
    logger.warn(`Wrote to: ${path}`);
    return path;
  }
  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, error, context) =>
      emit("error", message, {
        ...context,
        ...(error !== undefined ? { error: normalizeError(error) } : {}),
      }),
    createJsonFile: createJsonFile,
    child: (context) => createLogger({ ...baseContext, ...context }),
  };
}

export const logger = createLogger();
