/**
 * Notification service — polls GPS devices every 15s, detects events,
 * waits 2 seconds before broadcasting to the admin app cache (invalidation)
 * and another 2 seconds before sending Telegram alerts to clients.
 *
 * Events:
 *   - Engine ON  (disconnected → active)
 *   - Engine OFF (active → disconnected)
 *   - Speed exceeded (>90 km/h)
 *   - Status change (active states only)
 */
import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const SPEED_LIMIT_KMH = 90;
const POLL_INTERVAL_MS = 15_000;
const DELAY_APP_MS = 2_000;      // delay before marking as changed in cache
const DELAY_TELEGRAM_MS = 2_000; // delay after app update before sending Telegram

// In-memory snapshot: deviceId → state
interface Snap {
  status: string;
  speed: number | null;
  speedAlerted: boolean;
}

const snaps = new Map<string, Snap>();

// Pending alerts queue (device-level deduplication)
const pendingAlerts = new Map<string, NodeJS.Timeout>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stEmoji(s: string) {
  switch (s) {
    case "moving": return "🟢";
    case "ack": return "🟡";
    case "engine_idle": return "🟠";
    case "disconnected_red": return "🔴";
    case "disconnected_blue": return "🔵";
    default: return "⚪";
  }
}

function stLabel(s: string) {
  switch (s) {
    case "moving": return "En Movimiento";
    case "ack": return "ACK (Encendido)";
    case "engine_idle": return "Motor en Ralentí";
    case "disconnected_red": return "Desconectado — Sin Señal";
    case "disconnected_blue": return "Desconectado";
    default: return "Desconocido";
  }
}

function isDisconnected(status: string) {
  return status === "disconnected_blue" || status === "disconnected_red";
}

async function sendTelegram(bot: Telegraf, chatId: string, text: string) {
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    logger.warn({ err, chatId }, "Telegram send failed");
  }
}

async function dispatchAlerts(
  bot: Telegraf,
  recipients: string[],
  messages: string[]
): Promise<void> {
  if (messages.length === 0 || recipients.length === 0) return;

  // Step 1: wait 2s for app (simulate cache invalidation signal)
  await sleep(DELAY_APP_MS);

  // Step 2: wait another 2s before Telegram
  await sleep(DELAY_TELEGRAM_MS);

  for (const msg of messages) {
    for (const chatId of recipients) {
      await sendTelegram(bot, chatId, msg);
    }
  }
}

async function pollAndNotify(bot: Telegraf): Promise<void> {
  try {
    const [clients, vehicles, devices] = await Promise.all([
      db.select().from(clientsTable).where(isNotNull(clientsTable.telegramId)),
      db.select().from(clientVehiclesTable),
      fetchDevices(),
    ]);

    // Build map: deviceId → telegramIds[]
    const deviceOwners = new Map<string, string[]>();
    for (const v of vehicles) {
      const client = clients.find((c) => c.id === v.clientId);
      if (!client?.telegramId) continue;
      const arr = deviceOwners.get(v.deviceId) ?? [];
      arr.push(client.telegramId);
      deviceOwners.set(v.deviceId, arr);
    }

    for (const device of devices) {
      const owners = deviceOwners.get(device.id);
      const prev = snaps.get(device.id);
      const plate = vehicles.find((v) => v.deviceId === device.id)?.plate || device.plate || device.name;

      if (!prev) {
        snaps.set(device.id, { status: device.status, speed: device.speed, speedAlerted: false });
        continue;
      }

      const msgs: string[] = [];
      const wasDisc = isDisconnected(prev.status);
      const isDisc = isDisconnected(device.status);

      // Engine ON
      if (wasDisc && !isDisc) {
        msgs.push(
          `🔑 *Vehículo Encendido*\n\n` +
          `🚗 *${plate}*\n` +
          `${stEmoji(device.status)} ${stLabel(device.status)}\n` +
          (device.lat && device.lng
            ? `📍 [Ver ubicación](https://maps.google.com/?q=${device.lat},${device.lng})`
            : `📍 Posición no disponible`)
        );
      }

      // Engine OFF / disconnected
      if (!wasDisc && isDisc) {
        msgs.push(
          `🔴 *Vehículo Apagado / Desconectado*\n\n` +
          `🚗 *${plate}*\n` +
          `${stEmoji(device.status)} ${stLabel(device.status)}\n` +
          `🕐 Última conexión: ${device.lastConnection}`
        );
      }

      // Speed alert
      const spd = device.speed ?? 0;
      if (device.status === "moving" && spd > SPEED_LIMIT_KMH && !prev.speedAlerted) {
        msgs.push(
          `⚠️ *EXCESO DE VELOCIDAD*\n\n` +
          `🚗 *${plate}*\n` +
          `🚨 Velocidad: *${spd} km/h* (límite: ${SPEED_LIMIT_KMH} km/h)\n` +
          (device.lat && device.lng
            ? `📍 [Ver en mapa](https://maps.google.com/?q=${device.lat},${device.lng})`
            : "")
        );
        snaps.set(device.id, { ...prev, speedAlerted: true });
      }
      if (spd <= SPEED_LIMIT_KMH && prev.speedAlerted) {
        snaps.set(device.id, { ...prev, speedAlerted: false });
      }

      // Status change (between active states)
      if (
        prev.status !== device.status &&
        !wasDisc && !isDisc &&
        device.status !== "moving"
      ) {
        msgs.push(
          `${stEmoji(device.status)} *Cambio de Estado*\n\n` +
          `🚗 *${plate}*\n` +
          `Estado: ${stLabel(device.status)}`
        );
      }

      // Update snapshot
      snaps.set(device.id, {
        status: device.status,
        speed: device.speed,
        speedAlerted: snaps.get(device.id)?.speedAlerted ?? false,
      });

      // Dispatch with delays (only if owners exist and messages to send)
      if (msgs.length > 0 && owners && owners.length > 0) {
        // Debounce per device to avoid duplicates on rapid polls
        const existing = pendingAlerts.get(device.id);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          pendingAlerts.delete(device.id);
          void dispatchAlerts(bot, owners, msgs);
        }, 500);

        pendingAlerts.set(device.id, timer);
      }
    }
  } catch (err) {
    logger.error({ err }, "Notification poll error");
  }
}

export function startNotificationService(bot: Telegraf): void {
  logger.info("GPS notification service started (poll: 15s, delay: app+2s → telegram+2s)");

  // First poll after 30s warmup
  setTimeout(() => {
    void pollAndNotify(bot);
    setInterval(() => void pollAndNotify(bot), POLL_INTERVAL_MS);
  }, 30_000);
}
