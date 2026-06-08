---
name: Replit production database connectivity
description: How to connect to external PostgreSQL from Replit's production environment
---

## Rule
Use Neon's HTTP driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`) for Neon databases.
Store the connection URL as `APP_DATABASE_URL`, NOT `DATABASE_URL`.

**Why:**
1. Replit injects its own managed `DATABASE_URL` in production, overriding any user-set secret with the same name. In dev the user's secret wins; in production Replit's injection wins.
2. Replit's production environment blocks outbound TCP on port 5432 for external hosts. The Neon HTTP driver uses HTTPS (port 443) instead, bypassing the firewall.

**How to apply:**
- In `lib/db/src/index.ts`: read `process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL`
- When `dbUrl.includes("neon.tech")`: use `neon(dbUrl)` + `drizzle(sql, { schema })` from `drizzle-orm/neon-http`
- Otherwise: use standard `pg.Pool` + `drizzle-orm/node-postgres`
- Set `APP_DATABASE_URL` as the Replit Secret (not `DATABASE_URL`)
