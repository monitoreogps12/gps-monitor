/**
 * Notification service — polls GPS devices every 30s and sends Telegram alerts
 * to clients whose vehicles triggered an event:
 *   - Engine ON (ack / engine_idle from disconnected)
 *   - Speed exceeded (>90 km/h)
 *   - Status change (connected ↔ disconnected)
 */
import { Telegraf, type Context } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { fetchDevices, type GpsDevice } from "../lib/gps-service";
import { logger } from "../lib/logger";

const SPEED_LIMIT_KMH = 90;
const POLL_INTERVAL_MS = 30_000;

// Previous state snapshot per device
interface DeviceSnapshot {
  status: string;
  speed: number | null;
  alerted: boolean; // speed alert sent this session
}

const snapshots = new Map<string, DeviceSnapshot>();

function statusEmoji(status: string): string {
  switch (status) {
    case "moving": return "🟢";
    case "ack": return "🟡";
    case "engine_idle": return "🟠";
    case "disconnected_red": return "🔴";
    case "disconnected_blue": return "🔵";
    default: return "⚪";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "moving": return "En Movimiento";
    case "ack": return "ACK (Encendido)";
    case "engine_idle": return "Motor en Ralentí";
    case "disconnected_red": return "Desconectado (Sin Señal)";
    case "disconnected_blue": return "Desconectado";
    default: return "Desconocido";
  }
}

async function sendAlert(bot: Telegraf, telegramId: string, message: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(telegramId, message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    logger.warn({ err, telegramId }, "Failed to send Telegram notification");
  }
}

async function pollAndNotify(bot: Telegraf): Promise<void> {
  try {
    // Fetch all clients with telegram IDs and their vehicles
    const clients = await db.select().from(clientsTable).where(isNotNull(clientsTable.telegramId));
    const vehicles = await db.select().from(clientVehiclesTable);

    // Build map: deviceId -> list of client telegramIds
    const deviceToClients = new Map<string, string[]>();
    for (const v of vehicles) {
      const client = clients.find((c) => c.id === v.clientId);
      if (!client?.telegramId) continue;
      const existing = deviceToClients.get(v.deviceId) ?? [];
      existing.push(client.telegramId);
      deviceToClients.set(v.deviceId, existing);
      // Store plate/name for messages
      (v as typeof v & { _plate?: string })._plate = v.plate || v.deviceId;
    }

    if (deviceToClients.size === 0) return;

    const devices = await fetchDevices();

    for (const device of devices) {
      const clientTgIds = deviceToClients.get(device.id);
      if (!clientTgIds || clientTgIds.length === 0) continue;

      const prev = snapshots.get(device.id);
      const vehicleRow = vehicles.find((v) => v.deviceId === device.id);
      const plate = vehicleRow?.plate || device.plate || device.name;

      // Initialize snapshot on first sight
      if (!prev) {
        snapshots.set(device.id, {
          status: device.status,
          speed: device.speed,
          alerted: false,
        });
        continue;
      }

      const wasDisconnected = prev.status === "disconnected_blue" || prev.status === "disconnected_red";
      const isDisconnected = device.status === "disconnected_blue" || device.status === "disconnected_red";
      const wasActive = !wasDisconnected;
      const isActive = !isDisconnected;

      const messages: string[] = [];

      // Engine ON — vehicle went from disconnected to active
      if (wasDisconnected && isActive) {
        messages.push(
          `🟢 *Vehículo Encendido*\n\n` +
          `🚗 *${plate}*\n` +
          `Estado: ${statusEmoji(device.status)} ${statusLabel(device.status)}\n` +
          (device.lat && device.lng ? `📍 [Ver ubicación](https://maps.google.com/?q=${device.lat},${device.lng})` : "")
        );
      }

      // Vehicle disconnected (went offline)
      if (wasActive && isDisconnected) {
        messages.push(
          `🔴 *Vehículo Apagado / Desconectado*\n\n` +
          `🚗 *${plate}*\n` +
          `Estado: ${statusEmoji(device.status)} ${statusLabel(device.status)}\n` +
          `Última actividad: ${device.lastConnection}`
        );
      }

      // Speed alert — exceeded limit
      const speed = device.speed ?? 0;
      if (device.status === "moving" && speed > SPEED_LIMIT_KMH && !prev.alerted) {
        messages.push(
          `⚠️ *EXCESO DE VELOCIDAD*\n\n` +
          `🚗 *${plate}*\n` +
          `🚨 Velocidad actual: *${speed} km/h* (límite: ${SPEED_LIMIT_KMH} km/h)\n` +
          (device.lat && device.lng ? `📍 [Ver en mapa](https://maps.google.com/?q=${device.lat},${device.lng})` : "")
        );
        snapshots.set(device.id, { ...prev, alerted: true });
      }

      // Reset speed alert once under limit
      if (speed <= SPEED_LIMIT_KMH && prev.alerted) {
        snapshots.set(device.id, { ...prev, alerted: false });
      }

      // Status change notification (for other transitions)
      if (
        prev.status !== device.status &&
        !wasDisconnected &&
        !isDisconnected &&
        device.status !== "moving"
      ) {
        messages.push(
          `${statusEmoji(device.status)} *Cambio de Estado*\n\n` +
          `🚗 *${plate}*\n` +
          `Estado: ${statusLabel(device.status)}`
        );
      }

      // Update snapshot
      snapshots.set(device.id, {
        status: device.status,
        speed: device.speed,
        alerted: snapshots.get(device.id)?.alerted ?? false,
      });

      // Send all messages to all owners
      for (const msg of messages) {
        for (const tgId of clientTgIds) {
          await sendAlert(bot, tgId, msg);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Notification poll error");
  }
}

export function startNotificationService(bot: Telegraf): void {
  logger.info("Starting GPS notification service...");

  // First poll after 60s (let system warm up)
  setTimeout(() => {
    void pollAndNotify(bot);
    setInterval(() => void pollAndNotify(bot), POLL_INTERVAL_MS);
  }, 60_000);
}
