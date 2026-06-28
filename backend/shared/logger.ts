 type LogLevel = "debug" | "info" | "warn" | "error";
 type LogContext = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

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
  // Structured JSON in production (one line per event, ready for log
  // aggregation); a compact human-readable line in development.
  if (IS_PRODUCTION) return JSON.stringify(record);

  const { timestamp, message, ...rest } = record;
  const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${meta}`;
}

 interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  /** Logs an error. Pass the caught value as `error` to capture name/stack. */
  error(message: string, error?: unknown, context?: LogContext): void;
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

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, error, context) =>
      emit("error", message, {
        ...context,
        ...(error !== undefined ? { error: normalizeError(error) } : {}),
      }),
    child: (context) => createLogger({ ...baseContext, ...context }),
  };
}

 export const logger = createLogger();
