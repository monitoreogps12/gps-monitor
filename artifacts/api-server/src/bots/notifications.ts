import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchPlatformEvents, fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 5_000;
const EVENT_BUFFER_SIZE = 100;

let lastEventId = 0;
let polling = false;

// ── In-memory ring buffer of recent events ──────────────────────────────────
export interface RecentEventEntry {
  id: number;              // sequential local id
  platformEventId: number;
  deviceId: string;
  deviceName: string;
  plate: string;
  message: string;
  time: string;
  lat: number | null;
  lng: number | null;
  dispatched: boolean;
  clientNames: string[];
  seenAt: string;
}

let nextLocalId = 1;
const recentEvents: RecentEventEntry[] = [];

function pushEvent(entry: Omit<RecentEventEntry, "id">) {
  recentEvents.unshift({ id: nextLocalId++, ...entry });
  if (recentEvents.length > EVENT_BUFFER_SIZE) recentEvents.length = EVENT_BUFFER_SIZE;
}

/** Returns the last N events (newest first). Called by the API route. */
export function getRecentEvents(limit = 50): RecentEventEntry[] {
  return recentEvents.slice(0, limit);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function getFecha(platformTime?: string): string {
  if (platformTime) return platformTime;
  return new Date()
    .toLocaleString("es-VE", { timeZone: "America/Caracas" })
    .replace(",", "");
}

async function sendTelegram(bot: Telegraf, chatId: string, text: string) {
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    logger.warn({ err, chatId }, "Telegram send failed");
  }
}

async function sendLocation(bot: Telegraf, chatId: string, lat: number, lng: number) {
  try {
    await bot.telegram.sendLocation(chatId, lat, lng);
  } catch (err) {
    logger.warn({ err, chatId }, "Telegram sendLocation failed");
  }
}

// ── Poll loop ────────────────────────────────────────────────────────────────
async function pollAndNotify(bot: Telegraf): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const events = await fetchPlatformEvents(lastEventId);
    if (events.length === 0) return;

    if (lastEventId === 0) {
      lastEventId = Math.max(...events.map((e) => e.id));
      // Seed buffer with startup events (not dispatched)
      for (const event of [...events].reverse()) {
        const seenAt = new Date().toISOString();
        pushEvent({
          platformEventId: event.id,
          deviceId: event.deviceId,
          deviceName: "",
          plate: "",
          message: event.message,
          time: event.time,
          lat: event.lat,
          lng: event.lng,
          dispatched: false,
          clientNames: [],
          seenAt,
        });
      }
      logger.info({ lastEventId }, "Platform events initialized");
      return;
    }

    // Load clients + vehicles for this poll cycle
    const [clients, vehicles] = await Promise.all([
      db.select().from(clientsTable).where(isNotNull(clientsTable.telegramId)),
      db.select().from(clientVehiclesTable),
    ]);

    const deviceOwners = new Map<string, string[]>();
    for (const v of vehicles) {
      const client = clients.find((c) => c.id === v.clientId);
      if (!client?.telegramId) continue;
      const arr = deviceOwners.get(v.deviceId) ?? [];
      arr.push(client.telegramId);
      deviceOwners.set(v.deviceId, arr);
    }

    const vehicleByDevice = new Map(vehicles.map((v) => [v.deviceId, v]));
    const clientById = new Map(clients.map((c) => [c.id, c]));

    // Also build deviceId → clientNames for the buffer (all clients, not just Telegram ones)
    const allVehicles = await db.select().from(clientVehiclesTable);
    const allClients = await db.select().from(clientsTable);
    const clientsByDevice = new Map<string, string[]>();
    for (const v of allVehicles) {
      const c = allClients.find((x) => x.id === v.clientId);
      if (!c) continue;
      const arr = clientsByDevice.get(v.deviceId) ?? [];
      arr.push(c.name);
      clientsByDevice.set(v.deviceId, arr);
    }

    for (const event of events) {
      lastEventId = Math.max(lastEventId, event.id);

      const vRel = vehicleByDevice.get(event.deviceId);
      const plate = vRel?.plate ?? "";
      const deviceName = vRel?.deviceName ?? "";

      const allClientNames = clientsByDevice.get(event.deviceId) ?? [];

      const owners = deviceOwners.get(event.deviceId);
      const dispatched = !!(owners && owners.length > 0);

      // Always push to buffer regardless of client assignment
      pushEvent({
        platformEventId: event.id,
        deviceId: event.deviceId,
        deviceName,
        plate,
        message: event.message,
        time: event.time,
        lat: event.lat,
        lng: event.lng,
        dispatched,
        clientNames: allClientNames,
        seenAt: new Date().toISOString(),
      });

      // Only dispatch Telegram if owner has Telegram configured
      if (!dispatched) continue;

      const cRel = vRel ? clientById.get(vRel.clientId) : undefined;
      const clientName = cRel?.name ?? "Cliente GPS";

      const mapsUrl =
        event.lat && event.lng
          ? `[Ver en Google Maps](https://www.google.com/maps?q=${event.lat},${event.lng})`
          : "_Sin señal GPS_";

      const text =
        `🔔 *AVISO DE MONITOREO*\n\n` +
        `👤 *Cliente:*   ${clientName}\n` +
        `🚗 *Vehículo:* ${deviceName || "Vehículo"}\n` +
        `🔖 *Placa:*      ${plate || "S/P"}\n` +
        `⚠️ *Evento:*    ${event.message}\n` +
        `🕒 *Fecha:*      ${getFecha(event.time)}\n` +
        `📍 *Ubicación:* ${mapsUrl}`;

      for (const chatId of owners!) {
        await sendTelegram(bot, chatId, text);
        if (event.lat && event.lng) {
          await sendLocation(bot, chatId, event.lat, event.lng);
        }
      }

      logger.info(
        { eventId: event.id, deviceId: event.deviceId, message: event.message },
        "Platform event dispatched"
      );
    }
  } catch (err) {
    logger.error({ err }, "Notification poll error");
  } finally {
    polling = false;
  }
}

export function startNotificationService(bot: Telegraf): void {
  logger.info("GPS notification service started (platform events, poll: 5s)");
  void fetchDevices().catch(() => {});

  const schedule = () => {
    setTimeout(async () => {
      await pollAndNotify(bot);
      schedule();
    }, POLL_INTERVAL_MS);
  };

  setTimeout(async () => {
    await pollAndNotify(bot);
    schedule();
  }, 3_000);
}
