import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchLivePositions, fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const SPEED_LIMIT_KMH = 90;
const POLL_INTERVAL_MS = 2_000;

// In-memory snapshot: deviceId → state
interface Snap {
  status: string;
  speed: number | null;
  speedAlerted: boolean;
}

const snaps = new Map<string, Snap>();
const pendingAlerts = new Map<string, NodeJS.Timeout>();

// Prevent concurrent polls from stacking
let polling = false;

function stEmoji(s: string) {
  switch (s) {
    case "moving":            return "🟢";
    case "ack":               return "🟡";
    case "engine_idle":       return "🟠";
    case "disconnected_red":  return "🔴";
    case "disconnected_blue": return "🔵";
    default:                  return "⚪";
  }
}

function stLabel(s: string) {
  switch (s) {
    case "moving":            return "En Movimiento";
    case "ack":               return "Encendido (ACK)";
    case "engine_idle":       return "Motor en Ralentí";
    case "disconnected_red":  return "Sin Señal";
    case "disconnected_blue": return "Desconectado";
    default:                  return "Desconocido";
  }
}

function isDisconnected(status: string) {
  return status === "disconnected_blue" || status === "disconnected_red";
}

function getFecha(): string {
  return new Date()
    .toLocaleString("es-VE", { timeZone: "America/Caracas" })
    .replace(",", "");
}

function sep() { return "─".repeat(26); }

interface Alert {
  text: string;
  lat?: number | null;
  lng?: number | null;
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

async function dispatchAlerts(bot: Telegraf, recipients: string[], alerts: Alert[]): Promise<void> {
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
  if (polling) return; // skip if previous poll still running
  polling = true;
  try {
    // fetchLivePositions is fast (<1s, incremental). fetchDevices is the slow one.
    const [clients, vehicles, positions] = await Promise.all([
      db.select().from(clientsTable).where(isNotNull(clientsTable.telegramId)),
      db.select().from(clientVehiclesTable),
      fetchLivePositions(),
    ]);

    // Build map: deviceId → [telegramId, ...]
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

      // Initialize snapshot on first sight — no alert
      if (!prev) {
        snaps.set(device.id, { status: device.status, speed: device.speed, speedAlerted: false });
        continue;
      }

      const alerts: Alert[] = [];
      const wasDisc = isDisconnected(prev.status);
      const isDisc = isDisconnected(device.status);
      const fecha = getFecha();
      const hasGps = !!(device.lat && device.lng);
      const mapsLink = hasGps
        ? `[📍 Google Maps](https://www.google.com/maps?q=${device.lat},${device.lng})`
        : null;

      // Helper: build compact alert card
      const card = (icon: string, evento: string, extra?: string) =>
        `🔔 *AVISO DE MONITOREO*\n` +
        `${sep()}\n` +
        `${icon} *${evento}*\n` +
        `🚘 ${vehicleName}  •  🔖 ${plate}\n` +
        `👤 ${clientName}\n` +
        (extra ? `${extra}\n` : ``) +
        `🕒 ${fecha}\n` +
        `${sep()}\n` +
        (mapsLink ? `${mapsLink}` : `📍 _Sin señal GPS_`);

      // ── Engine ON (disconnected → active) ──────────────────────────────
      if (wasDisc && !isDisc) {
        alerts.push({
          text: card("🟢", "Vehículo Encendido", `📡 ${stLabel(device.status)}`),
          lat: device.lat, lng: device.lng,
        });
      }

      // ── Engine OFF (active → disconnected) ─────────────────────────────
      if (!wasDisc && isDisc) {
        alerts.push({
          text: card("🔴", "Vehículo Apagado / Desconectado",
            `🕐 Última conexión: ${device.lastConnection || "N/A"}`),
          lat: device.lat, lng: device.lng,
        });
      }

      // ── Speed exceeded ─────────────────────────────────────────────────
      const spd = device.speed ?? 0;
      if (device.status === "moving" && spd > SPEED_LIMIT_KMH && !prev.speedAlerted) {
        alerts.push({
          text: card("🚨", `Exceso de Velocidad: ${spd} km/h`,
            `⚠️ Límite configurado: ${SPEED_LIMIT_KMH} km/h`),
          lat: device.lat, lng: device.lng,
        });
        snaps.set(device.id, { ...prev, speedAlerted: true });
      }
      if (spd <= SPEED_LIMIT_KMH && prev.speedAlerted) {
        snaps.set(device.id, { ...prev, speedAlerted: false });
      }

      // ── Status change between active states (exclude ACK, exclude moving) ─
      if (
        prev.status !== device.status &&
        !wasDisc && !isDisc &&
        device.status !== "moving" &&
        device.status !== "ack"   // no alertar por ACK
      ) {
        alerts.push({
          text: card(stEmoji(device.status), stLabel(device.status)),
          lat: device.lat, lng: device.lng,
        });
      }

      // Update snapshot
      snaps.set(device.id, {
        status: device.status,
        speed: device.speed,
        speedAlerted: snaps.get(device.id)?.speedAlerted ?? false,
      });

      // Debounce dispatch: 200ms window per device
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
  logger.info("GPS notification service started (live-poll: 2s, no artificial delays)");

  // Warm up device metadata cache in background (non-blocking)
  void fetchDevices().catch(() => {/* ignore, will retry */});

  // Recursive setTimeout: each poll waits for the previous to complete
  const schedule = () => {
    setTimeout(async () => {
      await pollAndNotify(bot);
      schedule(); // schedule next only after this one finishes
    }, POLL_INTERVAL_MS);
  };

  // First poll after 2s warmup
  setTimeout(async () => {
    await pollAndNotify(bot);
    schedule();
  }, 2_000);
}
