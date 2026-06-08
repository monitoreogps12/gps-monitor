import pg from "pg";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// APP_DATABASE_URL takes priority over DATABASE_URL to avoid Replit's
// managed-database injection overriding an externally-configured DB.
const dbUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("APP_DATABASE_URL (or DATABASE_URL) must be set.");
}

const isNeon = dbUrl.includes("neon.tech");

// For Neon connections, use the HTTP driver which works over HTTPS (port 443)
// even in production environments where raw PostgreSQL TCP (port 5432) is blocked.
// For other databases (e.g. Replit internal Postgres), use the standard pg pool.
export const pool = isNeon
  ? null
  : new pg.Pool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });

const _db = isNeon
  ? neonDrizzle(neon(dbUrl), { schema })
  : pgDrizzle(pool!, { schema });

export const db = _db as ReturnType<typeof pgDrizzle<typeof schema>>;

export * from "./schema";
