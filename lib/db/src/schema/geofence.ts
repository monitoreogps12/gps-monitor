import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Custom alert zones drawn by the user on the map.
 * `points` is a JSON array of [lat, lng] pairs forming a closed polygon.
 */
export const alertZonesTable = pgTable("alert_zones", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  points:    text("points").notNull(),   // JSON: [[lat,lng],...]
  active:    boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AlertZone = typeof alertZonesTable.$inferSelect;
