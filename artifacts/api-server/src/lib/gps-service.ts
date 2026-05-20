import axios, { type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { logger } from "./logger";

const GPS_BASE_URL = "https://rastreoplus247.com";
const GPS_EMAIL = "olintoflores1@gmail.com";
const GPS_PASSWORD = "Olinto1234";

export type DeviceStatus =
  | "moving"
  | "disconnected_blue"
  | "disconnected_red"
  | "ack"
  | "engine_idle";

export interface GpsDevice {
  id: string;
  name: string;
  plate: string;
  imei: string;
  simNumber: string;
  model: string | null;
  status: DeviceStatus;
  speed: number | null;
  lastConnection: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  driver: string | null;
}

export interface LivePosition {
  id: string;
  name: string;
  plate: string;
  status: DeviceStatus;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  lastConnection: string;
  address: string | null;
  imei: string | null;
  simNumber: string | null;
  model: string | null;
  driver: string | null;
  zone: string | null;
  engineStatus: boolean | null;
  altitude: number | null;
  totalDistance: number | null;
  stopDurationSec: number | null;
}

export interface PlatformEvent {
  /** ID único creciente — úsalo para filtrar eventos ya procesados */
  id: number;
  /** ID del dispositivo en la plataforma */
  deviceId: string;
  /** Mensaje exacto de la plataforma en español */
  message: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  /** Hora formateada por la plataforma, ej: "20-05-2026 10:05:32 AM" */
  time: string;
}

let sessionCookies: string[] = [];
let lastLoginTime = 0;
let cachedDevices: GpsDevice[] = [];
let lastDeviceFetch = 0;
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_TTL = 5 * 60 * 1000;  // 5 min — device metadata rarely changes

function parseStatus(statusHtml: string): DeviceStatus {
  const color = statusHtml.match(/background-color:\s*([^;'"]+)/i)?.[1]?.trim().toLowerCase();
  const title = statusHtml.match(/title='([^']+)'/i)?.[1]?.toLowerCase() || "";

  if (color === "green" || title.includes("movimiento") || title.includes("moving")) return "moving";
  if (color === "orange" || title.includes("ralent") || title.includes("idle")) return "engine_idle";
  if (color === "yellow" || title.includes("ack")) return "ack";
  if (color === "red") return "disconnected_red";
  return "disconnected_blue";
}

function extractId(actionHtml: string): string {
  const match = actionHtml.match(/\/devices\/edit\/(\d+)/);
  return match ? match[1] : "";
}

function cleanPlate(plate: string): string {
  return plate.replace(/^PLACA\s*/i, "").trim();
}

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: GPS_BASE_URL,
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: (s) => s < 500,
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/json,*/*",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
  });
}

async function login(): Promise<boolean> {
  try {
    const client = createClient();

    // Get CSRF token
    const loginPage = await client.get("/authentication/create");
    const csrfMatch = loginPage.data?.match(/name="_token"\s+type="hidden"\s+value="([^"]+)"/);
    if (!csrfMatch) {
      logger.warn("Could not extract CSRF token from login page");
      return false;
    }
    const csrf = csrfMatch[1];
    const loginCookies: string[] = [];
    const setCookies = loginPage.headers["set-cookie"] || [];
    setCookies.forEach((c: string) => {
      const name = c.split("=")[0];
      const value = c.split("=")[1]?.split(";")[0];
      if (name && value) loginCookies.push(`${name}=${value}`);
    });

    // POST login
    const loginResp = await client.post(
      "/authentication/store",
      new URLSearchParams({
        _token: csrf,
        email: GPS_EMAIL,
        password: GPS_PASSWORD,
        remember_me: "1",
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": GPS_BASE_URL,
          "Referer": `${GPS_BASE_URL}/authentication/create`,
          "Cookie": loginCookies.join("; "),
        },
      }
    );

    const newCookies = loginResp.headers["set-cookie"] || [];
    sessionCookies = [...loginCookies];
    newCookies.forEach((c: string) => {
      const name = c.split("=")[0];
      const value = c.split("=")[1]?.split(";")[0];
      if (name && value) {
        // Update or add
        const idx = sessionCookies.findIndex((sc) => sc.startsWith(name + "="));
        if (idx >= 0) sessionCookies[idx] = `${name}=${value}`;
        else sessionCookies.push(`${name}=${value}`);
      }
    });

    const redirectLocation = loginResp.headers["location"] || "";
    if (loginResp.status === 302 && redirectLocation) {
      lastLoginTime = Date.now();
      logger.info({ redirect: redirectLocation }, "GPS login successful");
      return true;
    }

    logger.warn({ status: loginResp.status }, "GPS login may have failed");
    return sessionCookies.some((c) => c.startsWith("laravel_session="));
  } catch (err) {
    logger.error({ err }, "GPS login error");
    return false;
  }
}

async function ensureSession(): Promise<boolean> {
  if (Date.now() - lastLoginTime < SESSION_TTL && sessionCookies.length > 0) {
    return true;
  }
  return await login();
}

function cookieHeader(): string {
  return sessionCookies.join("; ");
}

export async function fetchDevices(): Promise<GpsDevice[]> {
  // Return cached if fresh enough
  if (Date.now() - lastDeviceFetch < CACHE_TTL && cachedDevices.length > 0) {
    return cachedDevices;
  }

  const ok = await ensureSession();
  if (!ok) throw new Error("Cannot authenticate with GPS platform");

  const client = createClient();

  try {
    const resp = await client.get("/objects/list/data", {
      params: {
        draw: 1,
        start: 0,
        length: 1000,
        "columns[0][data]": "name",
        "columns[0][name]": "name",
        "columns[1][data]": "status",
        "columns[1][name]": "status",
        "columns[2][data]": "imei",
        "columns[2][name]": "imei",
        "columns[3][data]": "sim_number",
        "columns[3][name]": "sim_number",
        "columns[4][data]": "device_model",
        "columns[4][name]": "device_model",
        "columns[5][data]": "plate_number",
        "columns[5][name]": "plate_number",
        "columns[6][data]": "registration_number",
        "columns[6][name]": "registration_number",
      },
      headers: {
        "Cookie": cookieHeader(),
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${GPS_BASE_URL}/objects/list`,
        "Accept": "application/json, text/plain, */*",
      },
    });

    if (!resp.data?.data) {
      // Session expired - retry login
      lastLoginTime = 0;
      const retryOk = await ensureSession();
      if (!retryOk) throw new Error("Session expired and re-login failed");
      return fetchDevices();
    }

    const rows = resp.data.data as Record<string, string>[];
    cachedDevices = rows.map((row): GpsDevice => {
      return {
        id: extractId(row.action || ""),
        name: row.name || "",
        plate: cleanPlate(row.plate_number || ""),
        imei: row.imei || "",
        simNumber: row.sim_number || "",
        model: row.device_model || null,
        status: parseStatus(row.status || ""),
        speed: null,
        lastConnection: row.installation_date || "",
        lat: null,
        lng: null,
        address: null,
        driver: row.registration_number || null,
      };
    }).filter((d) => d.id);

    lastDeviceFetch = Date.now();
    logger.info({ count: cachedDevices.length }, "Fetched GPS devices");
    return cachedDevices;
  } catch (err) {
    logger.error({ err }, "Failed to fetch GPS devices");
    if (cachedDevices.length > 0) return cachedDevices;
    throw err;
  }
}

function parseOnlineStatus(online: string, engineStatus: boolean): DeviceStatus {
  const s = (online || "").toLowerCase().trim();
  if (s === "online" || s === "moving") return "moving";
  if (engineStatus) return "engine_idle";
  if (s === "ack") return "ack";
  if (s === "offline") return "disconnected_blue";
  if (s === "blocked") return "disconnected_red";
  return "disconnected_blue";
}

// Cache for live positions (separate from device list cache)
let cachedLivePositions: LivePosition[] = [];
let lastLiveFetch = 0;
let liveCheckTimestamp = 0;
const LIVE_CACHE_TTL = 3 * 1000; // 3 seconds

export async function fetchLivePositions(): Promise<LivePosition[]> {
  // Return cached if very fresh
  if (Date.now() - lastLiveFetch < LIVE_CACHE_TTL && cachedLivePositions.length > 0) {
    return cachedLivePositions;
  }

  const ok = await ensureSession();
  if (!ok) throw new Error("Cannot authenticate with GPS platform");

  const client = createClient();

  try {
    // Use the platform's live check endpoint: /objects/items_json
    // With time=0 returns full snapshot; with last timestamp returns incremental updates
    const resp = await client.get("/objects/items_json", {
      params: { time: liveCheckTimestamp },
      headers: {
        "Cookie": cookieHeader(),
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${GPS_BASE_URL}/objects`,
        "Accept": "application/json",
      },
    });

    if (resp.status === 200 && resp.data?.items) {
      const items = resp.data.items as Record<string, unknown>[];
      const newTimestamp = resp.data.time as number;

      // Build a map from the new items
      const updatesById = new Map<string, LivePosition>();
      for (const d of items) {
        const lat = parseFloat(String(d.lat || "0"));
        const lng = parseFloat(String(d.lng || "0"));
        if (!lat || !lng) continue;

        const id = String(d.id || "");
        const engineStatus = Boolean(d.engine_status);
        // Cross-reference with device cache for IMEI / SIM / model
        const dev = cachedDevices.find((dev) => dev.id === id);
        // Extraer nombre de geocerca — la plataforma puede exponerlo en
        // varios campos según la versión: zone_name, zone, zones, geofence
        const rawZone =
          d.zone_name ?? d.zone ?? d.geofence ?? d.geofence_name ?? null;
        const zoneName = rawZone ? String(rawZone).trim() || null : null;

        updatesById.set(id, {
          id,
          name: String(d.name || ""),
          plate: cleanPlate(String(d.plate_number || d.name || "")),
          status: parseOnlineStatus(String(d.online || ""), engineStatus),
          lat,
          lng,
          speed: d.speed != null ? parseFloat(String(d.speed)) : null,
          heading: d.course != null ? parseFloat(String(d.course)) : null,
          lastConnection: String(d.time || ""),
          address: d.address != null ? String(d.address) : null,
          imei: dev?.imei ?? null,
          simNumber: dev?.simNumber ?? null,
          model: dev?.model ?? null,
          driver: dev?.driver ?? null,
          zone: zoneName,
          engineStatus,
          altitude: d.altitude != null ? parseFloat(String(d.altitude)) : null,
          totalDistance: d.total_distance != null ? parseFloat(String(d.total_distance)) : null,
          stopDurationSec: d.stop_duration_sec != null ? parseFloat(String(d.stop_duration_sec)) : null,
        });
      }

      if (liveCheckTimestamp === 0) {
        // First call: use items as full snapshot
        cachedLivePositions = Array.from(updatesById.values());
      } else {
        // Incremental update: merge into existing cache
        const existingMap = new Map(cachedLivePositions.map((p) => [p.id, p]));
        updatesById.forEach((v, k) => existingMap.set(k, v));
        cachedLivePositions = Array.from(existingMap.values());
      }

      // Update timestamp for incremental future calls
      if (newTimestamp) liveCheckTimestamp = newTimestamp;
      lastLiveFetch = Date.now();

      logger.info({ count: cachedLivePositions.length, updates: updatesById.size }, "Fetched live positions");
      return cachedLivePositions;
    }

    logger.warn({ status: resp.status }, "Unexpected response from live positions endpoint");
    return cachedLivePositions;
  } catch (err) {
    logger.error({ err }, "Failed to fetch live positions");
    return cachedLivePositions;
  }
}

export async function fetchFleetStats() {
  const devices = await fetchDevices();
  const stats = {
    total: devices.length,
    moving: 0,
    disconnected: 0,
    ack: 0,
    engineIdle: 0,
    lastUpdated: new Date().toISOString(),
  };
  for (const d of devices) {
    if (d.status === "moving") stats.moving++;
    else if (d.status === "disconnected_blue" || d.status === "disconnected_red") stats.disconnected++;
    else if (d.status === "ack") stats.ack++;
    else if (d.status === "engine_idle") stats.engineIdle++;
  }
  return stats;
}

/**
 * Obtiene los eventos más recientes de la plataforma parseando /events.
 * La plataforma embebe cada evento como: app.events.add({...})
 * Los IDs son crecientes — usa `sinceId` para filtrar sólo los nuevos.
 */
export async function fetchPlatformEvents(sinceId = 0): Promise<PlatformEvent[]> {
  const ok = await ensureSession();
  if (!ok) return [];

  const client = createClient();
  try {
    const resp = await client.get("/events", {
      headers: {
        Cookie: cookieHeader(),
        Referer: `${GPS_BASE_URL}/objects`,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
    });

    if (typeof resp.data !== "string") return [];

    const events: PlatformEvent[] = [];
    const regex = /app\.events\.add\((\{[\s\S]*?\})\);/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(resp.data)) !== null) {
      try {
        const raw = JSON.parse(match[1]) as Record<string, unknown>;
        const id = Number(raw.id ?? 0);
        if (!id || id <= sinceId) continue;

        const lat = raw.latitude != null ? parseFloat(String(raw.latitude)) : null;
        const lng = raw.longitude != null ? parseFloat(String(raw.longitude)) : null;

        events.push({
          id,
          deviceId: String(raw.device_id ?? ""),
          message: String(raw.message ?? raw.name ?? ""),
          lat: lat && !isNaN(lat) ? lat : null,
          lng: lng && !isNaN(lng) ? lng : null,
          speed: raw.speed != null ? parseFloat(String(raw.speed)) : null,
          time: String(raw.time ?? ""),
        });
      } catch {
        // malformed JSON in one event — skip it
      }
    }

    return events.sort((a, b) => a.id - b.id);
  } catch (err) {
    logger.error({ err }, "Failed to fetch platform events");
    return [];
  }
}


export async function getConnectionStatus() {
  const ok = await ensureSession();
  return {
    connected: ok,
    platform: "rastreoplus247.com",
    lastSync: lastLoginTime > 0 ? new Date(lastLoginTime).toISOString() : null,
    error: ok ? null : "Cannot authenticate with rastreoplus247.com",
  };
}
