import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchLivePositions, fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const SPEED_LIMIT_KMH = 90;
const POLL_INTERVAL_MS = 2_000;

interface Snap {
  status: string;
  speed: number | null;
  speedAlerted: boolean;
}

const snaps = new Map<string, Snap>();
const pendingAlerts = new Map<string, NodeJS.Timeout>();
let polling = false;

function isDisconnected(status: string) {
  return status === "disconnected_blue" || status === "disconnected_red";
}

function getFecha(): string {
  return new Date()
    .toLocaleString("es-VE", { timeZone: "America/Caracas" })
    .replace(",", "");
}

interface Alert {
  text: string;
  lat?: number | null;
  lng?: number | null;
}

// Formato exacto del diseño aprobado:
// 🔔 AVISO DE MONITOREO
// 👤 Cliente / 🚗 Vehículo / 🔖 Placa / ⚠️ Evento / 🕒 Fecha / 📍 Ubicación
function buildAlert(
  clientName: string,
  vehicleName: string,
  plate: string,
  evento: string,
  lat?: number | null,
  lng?: number | null,
): Alert {
  const mapsUrl =
    lat && lng
      ? `[Ver en Google Maps](https://www.google.com/maps?q=${lat},${lng})`
      : "_Sin señal GPS_";

  const text =
    `🔔 *AVISO DE MONITOREO*\n\n` +
    `👤 *Cliente:*   ${clientName}\n` +
    `🚗 *Vehículo:* ${vehicleName}\n` +
    `🔖 *Placa:*      ${plate}\n` +
    `⚠️ *Evento:*    ${evento}\n` +
    `🕒 *Fecha:*      ${getFecha()}\n` +
    `📍 *Ubicación:* ${mapsUrl}`;

  return { text, lat, lng };
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

async function dispatchAlerts(
  bot: Telegraf,
  recipients: string[],
  alerts: Alert[],
): Promise<void> {
  if (alerts.length === 0 || recipients.length === 0) return;
  for (const alert of alerts) {
    for (const chatId of recipients) {
      await sendTelegram(bot, chatId, alert.text);
      if (alert.lat && alert.lng) {
        await sendLocation(bot, chatId, alert.lat, alert.lng);
      }
    }
  }
}

async function pollAndNotify(bot: Telegraf): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    // fetchLivePositions → rápido, incremental (<1s)
    // fetchDevices       → solo se usa para metadata, ya en caché (5 min TTL)
    const [clients, vehicles, positions] = await Promise.all([
      db.select().from(clientsTable).where(isNotNull(clientsTable.telegramId)),
      db.select().from(clientVehiclesTable),
      fetchLivePositions(),
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

    for (const device of positions) {
      const owners = deviceOwners.get(device.id);
      const prev = snaps.get(device.id);

      const vRel = vehicles.find((v) => v.deviceId === device.id);
      const cRel = clients.find((c) => c.id === vRel?.clientId);
      const plate = vRel?.plate || device.plate || "S/P";
      const vehicleName = vRel?.deviceName || device.name || "Vehículo";
      const clientName = cRel?.name || "Cliente GPS";

      if (!prev) {
        snaps.set(device.id, {
          status: device.status,
          speed: device.speed,
          speedAlerted: false,
        });
        continue;
      }

      const alerts: Alert[] = [];
      const wasDisc = isDisconnected(prev.status);
      const isDisc = isDisconnected(device.status);

      // ── Vehículo Encendido ─────────────────────────────────────────────
      if (wasDisc && !isDisc) {
        alerts.push(buildAlert(clientName, vehicleName, plate,
          "Vehículo Encendido 🟢", device.lat, device.lng));
      }

      // ── Vehículo Apagado ───────────────────────────────────────────────
      if (!wasDisc && isDisc) {
        alerts.push(buildAlert(clientName, vehicleName, plate,
          "Vehículo Apagado 🔴", device.lat, device.lng));
      }

      // ── Exceso de Velocidad ────────────────────────────────────────────
      const spd = device.speed ?? 0;
      if (device.status === "moving" && spd > SPEED_LIMIT_KMH && !prev.speedAlerted) {
        alerts.push(buildAlert(clientName, vehicleName, plate,
          `Exceso de Velocidad: *${spd} km/h* (límite ${SPEED_LIMIT_KMH} km/h) 🚨`,
          device.lat, device.lng));
        snaps.set(device.id, { ...prev, speedAlerted: true });
      }
      if (spd <= SPEED_LIMIT_KMH && prev.speedAlerted) {
        snaps.set(device.id, { ...prev, speedAlerted: false });
      }

      // Motor Ralentí, ACK y otros estados intermedios → sin alerta

      // Actualizar snapshot
      snaps.set(device.id, {
        status: device.status,
        speed: device.speed,
        speedAlerted: snaps.get(device.id)?.speedAlerted ?? false,
      });

      if (alerts.length > 0 && owners && owners.length > 0) {
        const existing = pendingAlerts.get(device.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          pendingAlerts.delete(device.id);
          void dispatchAlerts(bot, owners, alerts);
        }, 200);
        pendingAlerts.set(device.id, timer);
      }
    }
  } catch (err) {
    logger.error({ err }, "Notification poll error");
  } finally {
    polling = false;
  }
}

export function startNotificationService(bot: Telegraf): void {
  logger.info("GPS notification service started (live-poll every 2s)");

  // Precalentar caché de dispositivos en segundo plano (una sola vez)
  void fetchDevices().catch(() => {/* reintenta solo */});

  // setTimeout recursivo: espera a que termine antes de agendar el siguiente
  const schedule = () => {
    setTimeout(async () => {
      await pollAndNotify(bot);
      schedule();
    }, POLL_INTERVAL_MS);
  };

  setTimeout(async () => {
    await pollAndNotify(bot);
    schedule();
  }, 2_000);
}
