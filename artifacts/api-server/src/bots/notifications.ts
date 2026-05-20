import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const SPEED_LIMIT_KMH = 90;
const POLL_INTERVAL_MS = 2_000;
const DELAY_APP_MS = 1_000;      // 1s after detection → app update
const DELAY_TELEGRAM_MS = 1_000; // 1s after app → Telegram to client

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
    case "moving":
      return "🟢";
    case "ack":
      return "🟡";
    case "engine_idle":
      return "🟠";
    case "disconnected_red":
      return "🔴";
    case "disconnected_blue":
      return "🔵";
    default:
      return "⚪";
  }
}

function stLabel(s: string) {
  switch (s) {
    case "moving":
      return "En Movimiento";
    case "ack":
      return "ACK (Encendido)";
    case "engine_idle":
      return "Motor en Ralentí";
    case "disconnected_red":
      return "Desconectado (Sin Señal)";
    case "disconnected_blue":
      return "Desconectado";
    default:
      return "Desconocido";
  }
}

function isDisconnected(status: string) {
  return status === "disconnected_blue" || status === "disconnected_red";
}

function getFechaActual(): string {
  const ahora = new Date();
  // Formato de Venezuela (DD-MM-YYYY hh:mm:ss AM/PM)
  return ahora
    .toLocaleString("es-VE", { timeZone: "America/Caracas" })
    .replace(",", "");
}

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

async function dispatchAlerts(
  bot: Telegraf,
  recipients: string[],
  alerts: Alert[],
): Promise<void> {
  if (alerts.length === 0 || recipients.length === 0) return;

  // Step 1: 1s → app update
  await sleep(DELAY_APP_MS);

  // Step 2: 1s más → Telegram al cliente
  await sleep(DELAY_TELEGRAM_MS);

  for (const alert of alerts) {
    for (const chatId of recipients) {
      await sendTelegram(bot, chatId, alert.text);
      // Enviar ubicación nativa de Telegram si hay coordenadas
      if (alert.lat && alert.lng) {
        await sendLocation(bot, chatId, alert.lat, alert.lng);
      }
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

      const vehicleRelation = vehicles.find((v) => v.deviceId === device.id);
      const plate = vehicleRelation?.plate || device.plate || "S/P";
      const vehicleName =
        vehicleRelation?.deviceName || device.name || "Vehículo";

      // Buscar el nombre del cliente dueño para la plantilla
      const clientRelation = clients.find(
        (c) => c.id === vehicleRelation?.clientId,
      );
      const clientName = clientRelation?.name || "Cliente GPS";

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
      const fecha = getFechaActual();
      const hasGps = !!(device.lat && device.lng);
      const mapsLink = hasGps
        ? `[📍 Ver en Google Maps](https://www.google.com/maps?q=${device.lat},${device.lng})`
        : null;

      // ── Engine ON ──────────────────────────────────────────────────────
      if (wasDisc && !isDisc) {
        const text =
          `🟢 *VEHÍCULO ENCENDIDO*\n` +
          `${"─".repeat(28)}\n` +
          `👤 *Cliente:*   ${clientName}\n` +
          `🚘 *Vehículo:* ${vehicleName}\n` +
          `🔖 *Placa:*      ${plate}\n` +
          `${stEmoji(device.status)} *Estado:*     ${stLabel(device.status)}\n` +
          `🕒 *Hora:*       ${fecha}\n` +
          `${"─".repeat(28)}\n` +
          (mapsLink
            ? `${mapsLink}\n_(Se adjunta ubicación en tiempo real)_`
            : `📍 _Posición GPS no disponible_`);
        alerts.push({ text, lat: device.lat, lng: device.lng });
      }

      // ── Engine OFF ─────────────────────────────────────────────────────
      if (!wasDisc && isDisc) {
        const text =
          `🔴 *VEHÍCULO APAGADO / DESCONECTADO*\n` +
          `${"─".repeat(28)}\n` +
          `👤 *Cliente:*          ${clientName}\n` +
          `🚘 *Vehículo:*        ${vehicleName}\n` +
          `🔖 *Placa:*             ${plate}\n` +
          `${stEmoji(device.status)} *Estado:*          ${stLabel(device.status)}\n` +
          `🕐 *Última conexión:* ${device.lastConnection || "N/A"}\n` +
          `🕒 *Hora del aviso:*  ${fecha}\n` +
          `${"─".repeat(28)}\n` +
          (mapsLink
            ? `${mapsLink}\n_(Última posición conocida adjunta)_`
            : `📍 _Posición GPS no disponible_`);
        alerts.push({ text, lat: device.lat, lng: device.lng });
      }

      // ── Speed alert ────────────────────────────────────────────────────
      const spd = device.speed ?? 0;
      if (device.status === "moving" && spd > SPEED_LIMIT_KMH && !prev.speedAlerted) {
        const text =
          `⚠️ *EXCESO DE VELOCIDAD*\n` +
          `${"─".repeat(28)}\n` +
          `👤 *Cliente:*    ${clientName}\n` +
          `🚘 *Vehículo:*  ${vehicleName}\n` +
          `🔖 *Placa:*       ${plate}\n` +
          `🚨 *Velocidad:* *${spd} km/h*  _(límite: ${SPEED_LIMIT_KMH} km/h)_\n` +
          `🕒 *Hora:*        ${fecha}\n` +
          `${"─".repeat(28)}\n` +
          (mapsLink
            ? `${mapsLink}\n_(Ubicación en tiempo real adjunta)_`
            : `📍 _Posición GPS no disponible_`);
        alerts.push({ text, lat: device.lat, lng: device.lng });
        snaps.set(device.id, { ...prev, speedAlerted: true });
      }
      if (spd <= SPEED_LIMIT_KMH && prev.speedAlerted) {
        snaps.set(device.id, { ...prev, speedAlerted: false });
      }

      // ── Status change (between active states) ──────────────────────────
      if (prev.status !== device.status && !wasDisc && !isDisc && device.status !== "moving") {
        const text =
          `${stEmoji(device.status)} *CAMBIO DE ESTADO*\n` +
          `${"─".repeat(28)}\n` +
          `👤 *Cliente:*   ${clientName}\n` +
          `🚘 *Vehículo:* ${vehicleName}\n` +
          `🔖 *Placa:*      ${plate}\n` +
          `🔄 *Estado:*    ${stLabel(device.status)}\n` +
          `🕒 *Hora:*       ${fecha}\n` +
          `${"─".repeat(28)}\n` +
          (mapsLink
            ? `${mapsLink}\n_(Ubicación en tiempo real adjunta)_`
            : `📍 _Posición GPS no disponible_`);
        alerts.push({ text, lat: device.lat, lng: device.lng });
      }

      // Update snapshot
      snaps.set(device.id, {
        status: device.status,
        speed: device.speed,
        speedAlerted: snaps.get(device.id)?.speedAlerted ?? false,
      });

      // Dispatch with debounce per device
      if (alerts.length > 0 && owners && owners.length > 0) {
        const existing = pendingAlerts.get(device.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          pendingAlerts.delete(device.id);
          void dispatchAlerts(bot, owners, alerts);
        }, 500);
        pendingAlerts.set(device.id, timer);
      }
    }
  } catch (err) {
    logger.error({ err }, "Notification poll error");
  }
}

export function startNotificationService(bot: Telegraf): void {
  logger.info(
    "GPS notification service started (poll: 2s, delay: sistema → app +1s → telegram +1s)",
  );

  // First poll after short warmup, then every POLL_INTERVAL_MS
  setTimeout(() => {
    void pollAndNotify(bot);
    setInterval(() => void pollAndNotify(bot), POLL_INTERVAL_MS);
  }, 2_000);
}
