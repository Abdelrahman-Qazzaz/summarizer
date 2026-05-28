import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { getBaseEnv } from "../env";
import * as schema from "./schema";

const sql = neon(getBaseEnv().DATABASE_URL);

export const db = drizzle(sql, { schema });

export * from "./schema";
