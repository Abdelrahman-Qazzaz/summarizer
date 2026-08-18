/**
 * Shared constant, deliberately in a module with no side effects: migrate.ts
 * runs its migration at import time, so importing anything from it would run
 * it too.
 *
 * Relative to the working directory, which is the package root in development
 * and /app in the image.
 */
export const MIGRATIONS_FOLDER = "./drizzle";
