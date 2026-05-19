import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";

const SPEED_LIMIT_KMH = 90;
const POLL_INTERVAL_MS = 2_000;
const DELAY_APP_MS = 2_000; // delay before marking as changed in cache
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
  messages: string[],
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

      const msgs: string[] = [];
      const wasDisc = isDisconnected(prev.status);
      const isDisc = isDisconnected(device.status);
      const fecha = getFechaActual();

      // Base common layout logic generator
      const buildAlertMessage = (evento: string, incluirMaps = true) => {
        let msg =
          `🔔 *AVISO DE MONITOREO*\n\n` +
          `👤 *Cliente:* ${clientName}\n` +
          `🚘 *Vehículo:* ${vehicleName}\n` +
          `📍 *Placa:* ${plate}\n` +
          `⚠️ *Eventos:* ${evento}\n` +
          `🕒 *Fecha:* ${fecha}\n`;

        // CORREGIDO: Se cambió '0{device.lat}' por '${device.lat}' y la URL a la oficial de Google Maps
        if (incluirMaps && device.lat && device.lng) {
          msg += `📌 *Ubicación:* [Ver en Google Maps](https://www.google.com/maps?q=${device.lat},${device.lng})`;
        } else if (incluirMaps) {
          msg += `📌 *Ubicación:* Posición GPS no disponible`;
        }
        return msg;
      };

      // Engine ON
      if (wasDisc && !isDisc) {
        msgs.push(buildAlertMessage("Vehículo Encendido"));
      }

      // Engine OFF / disconnected
      if (!wasDisc && isDisc) {
        const lastConnStr = device.lastConnection
          ? `\n🕐 Última conexión: ${device.lastConnection}`
          : "";
        msgs.push(
          buildAlertMessage(
            `Vehículo Apagado / Desconectado (${stLabel(device.status)})${lastConnStr}`,
            false,
          ),
        );
      }

      // Speed alert
      const spd = device.speed ?? 0;
      if (
        device.status === "moving" &&
        spd > SPEED_LIMIT_KMH &&
        !prev.speedAlerted
      ) {
        msgs.push(
          buildAlertMessage(
            `💥 EXCESO DE VELOCIDAD a *${spd} km/h* (Límite: ${SPEED_LIMIT_KMH} km/h)`,
          ),
        );
        snaps.set(device.id, { ...prev, speedAlerted: true });
      }
      if (spd <= SPEED_LIMIT_KMH && prev.speedAlerted) {
        snaps.set(device.id, { ...prev, speedAlerted: false });
      }

      // Status change (between active states)
      if (
        prev.status !== device.status &&
        !wasDisc &&
        !isDisc &&
        device.status !== "moving"
      ) {
        msgs.push(
          buildAlertMessage(
            `Cambio de Estado: ${stEmoji(device.status)} ${stLabel(device.status)}`,
          ),
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
  logger.info(
    "GPS notification service started (poll: 15s, delay: app+2s → telegram+2s)",
  );

  // First poll after 30s warmup
  setTimeout(() => {
    void pollAndNotify(bot);
    setInterval(() => void pollAndNotify(bot), POLL_INTERVAL_MS);
  }, 30_000);
}
