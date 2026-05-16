import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  registeredAt: timestamp("registered_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const clientVehiclesTable = pgTable("client_vehicles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name").notNull().default(""),
  plate: text("plate").notNull().default(""),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, registeredAt: true, updatedAt: true });
export const selectClientSchema = createSelectSchema(clientsTable);
export const insertClientVehicleSchema = createInsertSchema(clientVehiclesTable).omit({ id: true, addedAt: true });

export type Client = typeof clientsTable.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type ClientVehicle = typeof clientVehiclesTable.$inferSelect;
export type InsertClientVehicle = z.infer<typeof insertClientVehicleSchema>;
