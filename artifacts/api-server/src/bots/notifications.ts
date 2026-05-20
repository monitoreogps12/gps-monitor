import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchPlatformEvents, fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const POLL_INTERVAL_MS = 5_000; // /events es HTML pesado — 5s es razonable

let lastEventId = 0;
let polling = false;

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

async function pollAndNotify(bot: Telegraf): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    // Primera vez: inicializar lastEventId sin enviar nada (evita flood al arrancar)
    const events = await fetchPlatformEvents(lastEventId);
    if (events.length === 0) return;

    if (lastEventId === 0) {
      // Arranque: sólo guardamos el ID más alto, no notificamos eventos pasados
      lastEventId = Math.max(...events.map((e) => e.id));
      logger.info({ lastEventId }, "Platform events initialized — no backlog sent");
      return;
    }

    // Carga clientes y vehículos para el mapeo deviceId → telegramIds
    const [clients, vehicles] = await Promise.all([
      db.select().from(clientsTable).where(isNotNull(clientsTable.telegramId)),
      db.select().from(clientVehiclesTable),
    ]);

    // deviceId → [telegramId, ...]
    const deviceOwners = new Map<string, string[]>();
    for (const v of vehicles) {
      const client = clients.find((c) => c.id === v.clientId);
      if (!client?.telegramId) continue;
      const arr = deviceOwners.get(v.deviceId) ?? [];
      arr.push(client.telegramId);
      deviceOwners.set(v.deviceId, arr);
    }

    // Mapa rápido para metadatos de vehículo/cliente
    const vehicleByDevice = new Map(vehicles.map((v) => [v.deviceId, v]));
    const clientById = new Map(clients.map((c) => [c.id, c]));

    for (const event of events) {
      lastEventId = Math.max(lastEventId, event.id);

      const owners = deviceOwners.get(event.deviceId);
      if (!owners || owners.length === 0) continue; // Dispositivo sin cliente asignado

      const vRel = vehicleByDevice.get(event.deviceId);
      const cRel = vRel ? clientById.get(vRel.clientId) : undefined;
      const plate = vRel?.plate || "S/P";
      const vehicleName = vRel?.deviceName || "Vehículo";
      const clientName = cRel?.name || "Cliente GPS";

      const mapsUrl =
        event.lat && event.lng
          ? `[Ver en Google Maps](https://www.google.com/maps?q=${event.lat},${event.lng})`
          : "_Sin señal GPS_";

      const text =
        `🔔 *AVISO DE MONITOREO*\n\n` +
        `👤 *Cliente:*   ${clientName}\n` +
        `🚗 *Vehículo:* ${vehicleName}\n` +
        `🔖 *Placa:*      ${plate}\n` +
        `⚠️ *Evento:*    ${event.message}\n` +
        `🕒 *Fecha:*      ${getFecha(event.time)}\n` +
        `📍 *Ubicación:* ${mapsUrl}`;

      for (const chatId of owners) {
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

  // Pre-calentar caché de dispositivos en segundo plano
  void fetchDevices().catch(() => {/* reintenta solo */});

  // setTimeout recursivo — espera a terminar antes de agendar el siguiente
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
