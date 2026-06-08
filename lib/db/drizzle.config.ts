import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const dbUrl = (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL)!;
const needsSsl = dbUrl.includes("supabase") || dbUrl.includes("neon.tech");

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
    ssl: needsSsl ? "require" : undefined,
  },
});
