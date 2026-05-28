import { defineConfig } from "drizzle-kit";
import { drizzleEnv } from "./shared/env";

export default defineConfig({
  schema: "./shared/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: drizzleEnv.DATABASE_URL,
  },
});
