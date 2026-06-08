import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// APP_DATABASE_URL takes priority over DATABASE_URL to avoid Replit's
// managed-database injection overriding an externally-configured DB.
const dbUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error(
    "APP_DATABASE_URL (or DATABASE_URL) must be set.",
  );
}

const isSupabase = dbUrl.includes("supabase");
const isNeon = dbUrl.includes("neon.tech");

export const pool = new Pool({
  connectionString: dbUrl,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  max: 5,
  ...(isSupabase
    ? { ssl: { rejectUnauthorized: false } }
    : isNeon
    ? { ssl: { rejectUnauthorized: false } }
    : { options: "--statement-timeout=15000" }),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
