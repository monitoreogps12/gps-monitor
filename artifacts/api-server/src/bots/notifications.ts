import { Telegraf } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable, alertZonesTable } from "@workspace/db";
import { isNotNull, eq } from "drizzle-orm";
import { fetchPlatformEvents, fetchDevices, fetchLivePositions } from "../lib/gps-service";
import { sendSupportBotAlert } from "./support-bot";
import { sendBorderAlert } from "./border-alert-bot";
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

    // telegramId → client name (for personalised messages per recipient)
    const telegramToName = new Map<string, string>();
    // deviceId → list of [telegramId, clientName] pairs
    const deviceOwners = new Map<string, string[]>();
    for (const v of vehicles) {
      const client = clients.find((c) => c.id === v.clientId);
      if (!client?.telegramId) continue;
      telegramToName.set(client.telegramId, client.name);
      const arr = deviceOwners.get(v.deviceId) ?? [];
      arr.push(client.telegramId);
      deviceOwners.set(v.deviceId, arr);
    }

    const vehicleByDevice = new Map(vehicles.map((v) => [v.deviceId, v]));

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

      const mapsUrl =
        event.lat && event.lng
          ? `[Ver en Google Maps](https://www.google.com/maps?q=${event.lat},${event.lng})`
          : "_Sin señal GPS_";

      for (const chatId of owners!) {
        // Use each recipient's own name — fixes shared-vehicle multi-client bug
        const clientName = telegramToName.get(chatId) ?? "Cliente GPS";

        const text =
          `🔔 *AVISO DE MONITOREO*\n\n` +
          `👤 *Cliente:*   ${clientName}\n` +
          `🚗 *Vehículo:* ${deviceName || "Vehículo"}\n` +
          `🔖 *Placa:*      ${plate || "S/P"}\n` +
          `⚠️ *Evento:*    ${event.message}\n` +
          `🕒 *Fecha:*      ${getFecha(event.time)}\n` +
          `📍 *Ubicación:* ${mapsUrl}`;

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

  // Start GSM signal monitor (runs every 5 minutes)
  startGsmMonitor();

  // Start custom geofence monitor (runs every 2 minutes)
  // Note: the old fixed 60km border line check has been replaced by this —
  // draw your own zones on the map to get alerts for the exact areas you care about.
  startGeofenceMonitor();
}

// ── GSM Signal Monitor ───────────────────────────────────────────────────────
const GSM_THRESHOLD = 40;
const GSM_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const GSM_COOLDOWN_MS = 30 * 60 * 1000;     // 30 minutes per device

/** deviceId → timestamp of last GSM alert sent */
const gsmAlertCooldown = new Map<string, number>();

async function checkGsmSignals(): Promise<void> {
  try {
    const positions = await fetchLivePositions();
    const lowGsm = positions.filter(
      (p) => p.gsmSignal !== null && p.gsmSignal < GSM_THRESHOLD
    );

    if (lowGsm.length === 0) return;

    const now = Date.now();
    const toAlert = lowGsm.filter((p) => {
      const last = gsmAlertCooldown.get(p.id) ?? 0;
      return now - last > GSM_COOLDOWN_MS;
    });

    if (toAlert.length === 0) return;

    const lines = toAlert.map((p) => {
      const signal = p.gsmSignal!;
      const emoji = signal === 0 ? "🔴" : signal < 20 ? "🔴" : "🟠";
      const name = p.name || p.id;
      const plate = p.plate && p.plate !== p.name ? ` (${p.plate})` : "";
      return `${emoji} *${name}*${plate} — GSM: *${Math.round(signal)}%*`;
    });

    const text =
      `📡 *ALERTA — SEÑAL GSM BAJA*\n\n` +
      `${lines.join("\n")}\n\n` +
      `⚠️ ${toAlert.length} vehículo${toAlert.length > 1 ? "s" : ""} con señal GSM por debajo del ${GSM_THRESHOLD}%.\n` +
      `🕒 ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}`;

    await sendSupportBotAlert(text);

    for (const p of toAlert) {
      gsmAlertCooldown.set(p.id, now);
    }

    logger.info({ count: toAlert.length, threshold: GSM_THRESHOLD }, "GSM alert sent");
  } catch (err) {
    logger.error({ err }, "GSM signal check failed");
  }
}

function startGsmMonitor(): void {
  // First check after 2 minutes (sensor cache needs time to populate)
  setTimeout(() => {
    void checkGsmSignals();
    setInterval(() => { void checkGsmSignals(); }, GSM_POLL_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

// ── Colombia Border Proximity Monitor ────────────────────────────────────────
//
// Sends an alert via the border-alert bot to all subscribers whenever a
// Teltonika-SIM vehicle is within BORDER_THRESHOLD_KM of the
// Venezuela-Colombia land border.
//
// Border polyline: simplified key points from Castilletes (north) to the
// Brazil tripoint (south).  Haversine distance to each segment is checked.

const BORDER_THRESHOLD_KM = 60;
const BORDER_POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const BORDER_COOLDOWN_MS      = 4 * 60 * 60 * 1000; // 4 hours per vehicle

/** deviceId → timestamp of last border alert sent */
const borderAlertCooldown = new Map<string, number>();

/** Approximate Venezuela-Colombia border as an ordered polyline [lat, lng]. */
const COLOMBIA_BORDER: [number, number][] = [
  [11.85, -71.32],  // Castilletes — Caribbean coast
  [11.36, -72.42],  // Paraguachón
  [10.38, -72.86],  // West of Maracaibo lake / Zulia
  [ 9.60, -72.85],  // Machiques area
  [ 8.60, -72.72],  // La Victoria / Táchira
  [ 7.87, -72.44],  // San Antonio del Táchira / Cúcuta
  [ 7.07, -70.73],  // Arauca crossing
  [ 6.21, -67.49],  // Puerto Páez / Puerto Carreño (Orinoco)
  [ 4.06, -67.72],  // San Fernando de Atabapo
  [ 1.84, -66.88],  // Piedra del Cocuy — Brazil tripoint
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Minimum haversine distance (km) from point to the segment (p1→p2). */
function distToSegmentKm(
  lat: number, lng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dx = lat2 - lat1, dy = lng2 - lng1;
  if (dx === 0 && dy === 0) return haversineKm(lat, lng, lat1, lng1);
  const t = Math.max(0, Math.min(1,
    ((lat - lat1) * dx + (lng - lng1) * dy) / (dx * dx + dy * dy),
  ));
  return haversineKm(lat, lng, lat1 + t * dx, lng1 + t * dy);
}

function isNearColombiaBorder(lat: number, lng: number): boolean {
  for (let i = 0; i < COLOMBIA_BORDER.length - 1; i++) {
    const [lat1, lng1] = COLOMBIA_BORDER[i]!;
    const [lat2, lng2] = COLOMBIA_BORDER[i + 1]!;
    if (distToSegmentKm(lat, lng, lat1, lng1, lat2, lng2) <= BORDER_THRESHOLD_KM) {
      return true;
    }
  }
  return false;
}

async function checkColombiaBorderAlerts(): Promise<void> {
  try {
    const positions = await fetchLivePositions();

    // Only Teltonika SIM lines
    const teltonika = positions.filter(
      (p) => p.simNumber?.toUpperCase().startsWith("TELTONIKA "),
    );

    if (teltonika.length === 0) return;

    const nearBorder = teltonika.filter((p) => isNearColombiaBorder(p.lat, p.lng));
    if (nearBorder.length === 0) return;

    const now = Date.now();
    const toAlert = nearBorder.filter((p) => {
      const last = borderAlertCooldown.get(p.id) ?? 0;
      return now - last > BORDER_COOLDOWN_MS;
    });

    if (toAlert.length === 0) return;

    for (const p of toAlert) {
      const mapsUrl = `https://maps.google.com/?q=${p.lat},${p.lng}`;
      const hora = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

      const estadoLabel: Record<string, string> = {
        moving: "En Movimiento 🟢",
        ack: "ACK 🟡",
        engine_idle: "Ralentí 🟠",
        disconnected_blue: "Desconectado 🔵",
        disconnected_red: "Sin Señal 🔴",
      };
      const estado = estadoLabel[p.status] ?? p.status;

      const text =
        `🚨 *ALERTA DE FRONTERA — COLOMBIA/VENEZUELA*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🚗 *Vehículo:* ${p.name || "—"}\n` +
        `🔖 *Placa:*    ${p.plate || "—"}\n` +
        `📱 *SIM:*      ${p.simNumber || "—"}\n` +
        `🖥️ *Modelo:*   ${p.model || "—"}\n` +
        `🛰️ *IMEI:*     ${p.imei || "—"}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📡 *Estado:* ${estado}\n` +
        (p.speed !== null ? `🚀 *Velocidad:* ${p.speed} km/h\n` : "") +
        `📍 *Posición:* [Ver en Google Maps](${mapsUrl})\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 Zona: *Frontera Colombia-Venezuela*\n` +
        `⚠️ A menos de *${BORDER_THRESHOLD_KM} km* de la frontera\n` +
        `🔄 *Revisar SIM* — posible cambio de cobertura\n` +
        `🕒 ${hora}`;

      await sendBorderAlert(text, p.lat, p.lng);
      borderAlertCooldown.set(p.id, now);

      logger.info(
        { deviceId: p.id, plate: p.plate, sim: p.simNumber, lat: p.lat, lng: p.lng },
        "Colombia border alert sent",
      );
    }
  } catch (err) {
    logger.error({ err }, "Colombia border check failed");
  }
}

function startBorderMonitor(): void {
  // First check after 3 minutes (allow live position cache to warm up)
  setTimeout(() => {
    void checkColombiaBorderAlerts();
    setInterval(() => { void checkColombiaBorderAlerts(); }, BORDER_POLL_INTERVAL_MS);
  }, 3 * 60 * 1000);
}

// ── Custom Geofence Monitor ───────────────────────────────────────────────────
//
// Loads alert zones from DB and checks all live vehicles (any SIM type) against
// each polygon using ray-casting. Sends a Telegram alert when a vehicle enters.

const GEOFENCE_POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const GEOFENCE_COOLDOWN_MS      = 4 * 60 * 60 * 1000; // 4 hours per vehicle+zone

/** "deviceId:zoneId" → timestamp of last alert sent */
const geofenceCooldown = new Map<string, number>();

/** Ray-casting point-in-polygon. polygon is [[lat,lng],...] */
function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i]!;
    const [latJ, lngJ] = polygon[j]!;
    const intersect =
      ((lngI > lng) !== (lngJ > lng)) &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function checkGeofenceAlerts(): Promise<void> {
  try {
    const [zones, positions] = await Promise.all([
      db.select().from(alertZonesTable).where(eq(alertZonesTable.active, true)),
      fetchLivePositions(),
    ]);

    if (zones.length === 0 || positions.length === 0) return;

    const now = Date.now();

    for (const zone of zones) {
      let polygon: [number, number][];
      try {
        polygon = JSON.parse(zone.points) as [number, number][];
      } catch { continue; }

      if (polygon.length < 3) continue;

      for (const p of positions) {
        const cooldownKey = `${p.id}:${zone.id}`;
        const last = geofenceCooldown.get(cooldownKey) ?? 0;
        if (now - last < GEOFENCE_COOLDOWN_MS) continue;

        if (!pointInPolygon(p.lat, p.lng, polygon)) continue;

        // Vehicle is inside the zone — send alert
        geofenceCooldown.set(cooldownKey, now);

        const hora = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
        const mapsUrl = `https://maps.google.com/?q=${p.lat},${p.lng}`;

        const estadoLabel: Record<string, string> = {
          moving: "En Movimiento 🟢",
          ack: "ACK 🟡",
          engine_idle: "Ralentí 🟠",
          disconnected_blue: "Desconectado 🔵",
          disconnected_red: "Sin Señal 🔴",
        };
        const estado = estadoLabel[p.status] ?? p.status;

        const isTeltonika = p.simNumber?.toUpperCase().startsWith("TELTONIKA ");

        const text =
          `🚧 *ALERTA DE GEOCERCA — ${zone.name.toUpperCase()}*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🚗 *Vehículo:* ${p.name || "—"}\n` +
          `🔖 *Placa:*    ${p.plate || "—"}\n` +
          `📱 *SIM:*      ${p.simNumber || "—"}\n` +
          `🖥️ *Modelo:*   ${p.model || "—"}\n` +
          `🛰️ *IMEI:*     ${p.imei || "—"}\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📡 *Estado:* ${estado}\n` +
          (p.speed !== null ? `🚀 *Velocidad:* ${p.speed} km/h\n` : "") +
          `📍 *Posición:* [Ver en Google Maps](${mapsUrl})\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 Zona: *${zone.name}*\n` +
          (isTeltonika
            ? `🔄 *Revisar SIM* — posible cambio de cobertura\n`
            : `⚠️ Vehículo cerca de límites fronterizos\n`) +
          `🕒 ${hora}`;

        await sendBorderAlert(text, p.lat, p.lng);

        logger.info(
          { deviceId: p.id, plate: p.plate, zone: zone.name },
          "Geofence alert sent",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Geofence check failed");
  }
}

function startGeofenceMonitor(): void {
  setTimeout(() => {
    void checkGeofenceAlerts();
    setInterval(() => { void checkGeofenceAlerts(); }, GEOFENCE_POLL_INTERVAL_MS);
  }, 4 * 60 * 1000); // first run after 4 minutes
}
