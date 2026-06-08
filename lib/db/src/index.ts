import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const dbUrl = process.env.DATABASE_URL;
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
