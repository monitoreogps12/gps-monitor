import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isSupabase = process.env.DATABASE_URL.includes("supabase");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  max: 5,
  ...(isSupabase
    ? { ssl: { rejectUnauthorized: false } }
    : { options: "--statement-timeout=15000" }),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
