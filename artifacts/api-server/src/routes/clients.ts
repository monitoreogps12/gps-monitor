import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// GET /clients - list all clients with their vehicles
router.get("/clients", async (req, res): Promise<void> => {
  try {
    const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
    const vehicles = await db.select().from(clientVehiclesTable);

    const result = clients.map((c) => ({
      ...c,
      registeredAt: c.registeredAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      vehicles: vehicles
        .filter((v) => v.clientId === c.id)
        .map((v) => ({ ...v, addedAt: v.addedAt.toISOString() })),
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list clients");
    res.status(500).json({ error: "Failed to list clients" });
  }
});

// POST /clients - create client
router.post("/clients", async (req, res): Promise<void> => {
  try {
    const { name, phone, telegramId, telegramUsername, notes } = req.body as Record<string, string>;
    if (!name || !phone) {
      res.status(400).json({ error: "name and phone are required" });
      return;
    }

    const [client] = await db
      .insert(clientsTable)
      .values({ name, phone, telegramId: telegramId || null, telegramUsername: telegramUsername || null, notes: notes || null })
      .returning();

    res.status(201).json({ ...client, registeredAt: client!.registeredAt.toISOString(), updatedAt: client!.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to create client");
    res.status(500).json({ error: "Failed to create client" });
  }
});

// GET /clients/:id
router.get("/clients/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "");
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, id));

    res.json({
      ...client,
      registeredAt: client.registeredAt.toISOString(),
      updatedAt: client.updatedAt.toISOString(),
      vehicles: vehicles.map((v) => ({ ...v, addedAt: v.addedAt.toISOString() })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get client");
    res.status(500).json({ error: "Failed to get client" });
  }
});

// PUT /clients/:id
router.put("/clients/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "");
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { name, phone, telegramId, telegramUsername, notes, isActive } = req.body as Record<string, unknown>;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates["name"] = name;
    if (phone !== undefined) updates["phone"] = phone;
    if (telegramId !== undefined) updates["telegramId"] = telegramId || null;
    if (telegramUsername !== undefined) updates["telegramUsername"] = telegramUsername || null;
    if (notes !== undefined) updates["notes"] = notes || null;
    if (isActive !== undefined) updates["isActive"] = isActive;

    const [client] = await db
      .update(clientsTable)
      .set(updates)
      .where(eq(clientsTable.id, id))
      .returning();

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }
    res.json({ ...client, registeredAt: client.registeredAt.toISOString(), updatedAt: client.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to update client");
    res.status(500).json({ error: "Failed to update client" });
  }
});

// DELETE /clients/:id
router.delete("/clients/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "");
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.delete(clientsTable).where(eq(clientsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete client");
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// POST /clients/:id/vehicles
router.post("/clients/:id/vehicles", async (req, res): Promise<void> => {
  try {
    const clientId = parseInt(req.params["id"] ?? "");
    if (isNaN(clientId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { deviceId, deviceName, plate } = req.body as Record<string, string>;
    if (!deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }

    const [vehicle] = await db
      .insert(clientVehiclesTable)
      .values({ clientId, deviceId, deviceName: deviceName || "", plate: plate || "" })
      .returning();

    res.status(201).json({ ...vehicle, addedAt: vehicle!.addedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to add vehicle");
    res.status(500).json({ error: "Failed to add vehicle" });
  }
});

// DELETE /clients/:id/vehicles/:deviceId
router.delete("/clients/:id/vehicles/:deviceId", async (req, res): Promise<void> => {
  try {
    const clientId = parseInt(req.params["id"] ?? "");
    const deviceId = req.params["deviceId"] ?? "";
    if (isNaN(clientId) || !deviceId) { res.status(400).json({ error: "Invalid params" }); return; }

    const { and } = await import("drizzle-orm");
    await db
      .delete(clientVehiclesTable)
      .where(and(eq(clientVehiclesTable.clientId, clientId), eq(clientVehiclesTable.deviceId, deviceId)));

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to remove vehicle");
    res.status(500).json({ error: "Failed to remove vehicle" });
  }
});

// Helper: send a Telegram message to a chat via Bot API
async function sendTelegramMsg(telegramId: string, text: string): Promise<void> {
  const token = process.env["TELEGRAM_CLIENT_BOT_TOKEN"];
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: "Markdown" }),
    });
  } catch (err) {
    // best-effort — don't fail the HTTP response if Telegram is unreachable
  }
}

// POST /clients/:id/notify-assignment — send Telegram message with assigned vehicle list
router.post("/clients/:id/notify-assignment", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "");
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    if (!client.telegramId) {
      res.json({ sent: false, reason: "no_telegram" });
      return;
    }

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, id));
    if (vehicles.length === 0) {
      res.json({ sent: false, reason: "no_vehicles" });
      return;
    }

    const vehicleList = vehicles
      .map((v) => `   🚗 *${v.plate || v.deviceName}*${v.plate && v.deviceName && v.plate !== v.deviceName ? ` — ${v.deviceName}` : ""}`)
      .join("\n");

    const text =
      `✅ *Sus vehículos han sido asignados*\n\n` +
      `Estimado/a *${client.name}*,\n\n` +
      `GPS SISTEMA C.A. le ha asignado los siguientes vehículos:\n\n` +
      vehicleList + "\n\n" +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `A partir de ahora recibirá notificaciones automáticas cuando sus vehículos:\n` +
      `• Se enciendan o apaguen\n` +
      `• Excedan 90 km/h\n` +
      `• Cambien de estado\n\n` +
      `Consulte su flota usando 🚗 *Mis Vehículos* en el menú.`;

    await sendTelegramMsg(client.telegramId, text);
    res.json({ sent: true });
  } catch (err) {
    req.log.error({ err }, "Failed to send assignment notification");
    res.status(500).json({ error: "Failed to send notification" });
  }
});

// POST /clients/:id/link-telegram — manually link a Telegram ID to a client
router.post("/clients/:id/link-telegram", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] ?? "");
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { telegramId, telegramUsername } = req.body as Record<string, string>;
    if (!telegramId) { res.status(400).json({ error: "telegramId is required" }); return; }

    const [client] = await db
      .update(clientsTable)
      .set({ telegramId, telegramUsername: telegramUsername || null, updatedAt: new Date() })
      .where(eq(clientsTable.id, id))
      .returning();

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }
    res.json({ ...client, registeredAt: client.registeredAt.toISOString(), updatedAt: client.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to link Telegram");
    res.status(500).json({ error: "Failed to link Telegram" });
  }
});

export default router;
