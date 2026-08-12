import axios, { type AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { logger } from "./logger";
import deviceLastSeenRaw from "../data/device-last-seen.json";

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
  engineHours: string | null;
  batteryLevel: string | null;
  gsmSignal: number | null;
}

export interface DeviceSensor {
  id: number;
  type: string;
  name: string;
  value: string;
  val: number | boolean | string | null;
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
        "columns[7][data]": "installation_date",
        "columns[7][name]": "installation_date",
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
        // Prefer the GPS platform's actual last-seen time; fall back to installation_date
        lastConnection: row.time || row.installation_date || "",
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

// Shared last-seen times populated by fetchLivePositions from items_json for ALL devices
// (including offline ones that have no coordinates). Used by fetchOfflineReport.
const lastSeenTimesCache = new Map<string, string>();
// True once the 7-day lookback has been completed; prevents rerunning on every call
// but also prevents the livePositions cache (only ~27 devices) from bypassing the lookback.
let fullLastSeenLookupDone = false;

// Cache for device sensors (refreshed every 5 minutes via /objects/items?full=true)
const sensorCache = new Map<string, DeviceSensor[]>();
let lastSensorFetch = 0;
const SENSOR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fallback last-known positions for ALL devices from /objects/items?full=true
// Key: device id, Value: partial LivePosition (lat/lng/time only)
const fallbackPositions = new Map<string, { lat: number; lng: number; lastConnection: string }>();

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
        // Capture last-seen time for ALL devices (including offline ones without coordinates)
        const itemId = String(d.id || "");
        const itemTime = String(d.time || "");
        if (itemId && itemTime) lastSeenTimesCache.set(itemId, itemTime);

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

        const sensors = sensorCache.get(id) ?? [];
        const engineHoursSensor = sensors.find((s) => s.type === "engine_hours");
        const batterySensor = sensors.find((s) => s.type === "battery");
        const gsmSensor = sensors.find((s) => s.type === "gsm");
        const gsmRaw = gsmSensor?.val;
        const gsmSignal =
          gsmRaw != null && gsmRaw !== "-" && !isNaN(parseFloat(String(gsmRaw)))
            ? parseFloat(String(gsmRaw))
            : null;

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
          engineHours: engineHoursSensor?.value ?? null,
          batteryLevel: batterySensor?.value ?? null,
          gsmSignal,
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

      // Trigger sensor cache refresh in background (non-blocking, every 5 mins)
      // refreshSensorCache also populates fallbackPositions with last-known coords
      void refreshSensorCache().then(async () => {
        // After sensor cache refresh, merge fallback positions for vehicles
        // that items_json never returns (long-offline, no active GPS signal).
        // Ensure device metadata is loaded so names/plates are correct.
        const allDevs = await fetchDevices().catch(() => cachedDevices);
        const liveIds = new Set(cachedLivePositions.map((p) => p.id));
        let added = 0;
        for (const [id, fb] of fallbackPositions) {
          if (liveIds.has(id)) continue; // already in live feed
          const dev = allDevs.find((d) => d.id === id);
          const sensors = sensorCache.get(id) ?? [];
          const batterySensor = sensors.find((s) => s.type === "battery");
          const gsmSensor    = sensors.find((s) => s.type === "gsm");
          const gsmRaw = gsmSensor?.val;
          const gsmSignal =
            gsmRaw != null && gsmRaw !== "-" && !isNaN(parseFloat(String(gsmRaw)))
              ? parseFloat(String(gsmRaw))
              : null;

          cachedLivePositions.push({
            id,
            name: dev?.name ?? id,
            plate: dev ? cleanPlate(dev.plate) : id,
            status: "disconnected_blue",
            lat: fb.lat,
            lng: fb.lng,
            speed: 0,
            heading: null,
            lastConnection: fb.lastConnection || dev?.lastConnection || "",
            address: null,
            imei: dev?.imei ?? null,
            simNumber: dev?.simNumber ?? null,
            model: dev?.model ?? null,
            driver: dev?.driver ?? null,
            zone: null,
            engineStatus: false,
            altitude: null,
            totalDistance: null,
            stopDurationSec: null,
            engineHours: null,
            batteryLevel: batterySensor?.value ?? null,
            gsmSignal,
          });
          added++;
        }
        if (added > 0) {
          logger.info({ added }, "Merged fallback positions into live cache");
        }
      });

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
 * Refresca el cache de sensores de todos los dispositivos.
 * Llama a /objects/items?full=true — 852KB aprox — cada 5 minutos.
 */
async function refreshSensorCache(): Promise<void> {
  if (Date.now() - lastSensorFetch < SENSOR_CACHE_TTL) return;
  const ok = await ensureSession();
  if (!ok) return;
  const client = createClient();
  try {
    const resp = await client.get("/objects/items", {
      params: { full: true },
      headers: {
        Cookie: cookieHeader(),
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${GPS_BASE_URL}/objects`,
        Accept: "application/json",
      },
    });
    if (resp.data?.data && Array.isArray(resp.data.data)) {
      const allItems = resp.data.data as Record<string, unknown>[];
      let fallbackCount = 0;
      for (const item of allItems) {
        const id = String(item.id ?? "");
        if (!id) continue;

        // Sensors
        const sensors = Array.isArray(item.sensors) ? (item.sensors as DeviceSensor[]) : [];
        sensorCache.set(id, sensors);

        // Fallback last-known position for offline vehicles
        // The /objects/items?full=true response includes lat/lng for all devices,
        // even those not returned by items_json (no recent GPS activity).
        const rawLat = item.lat ?? item.latitude ?? null;
        const rawLng = item.lng ?? item.longitude ?? null;
        const lat = rawLat != null ? parseFloat(String(rawLat)) : NaN;
        const lng = rawLng != null ? parseFloat(String(rawLng)) : NaN;
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
          const timeStr = String(item.time ?? item.last_connection ?? "");
          fallbackPositions.set(id, { lat, lng, lastConnection: timeStr });
          fallbackCount++;
        }
      }
      lastSensorFetch = Date.now();
      logger.info({ devices: sensorCache.size, withPosition: fallbackCount }, "Sensor cache refreshed");
    }
  } catch (err) {
    logger.error({ err }, "Failed to refresh sensor cache");
  }
}

/**
 * Obtiene sensores de un dispositivo específico.
 * Devuelve del cache si está disponible, si no hace una solicitud individual.
 */
export async function fetchDeviceSensors(deviceId: string): Promise<DeviceSensor[]> {
  if (sensorCache.has(deviceId)) return sensorCache.get(deviceId)!;

  const ok = await ensureSession();
  if (!ok) return [];
  const client = createClient();
  try {
    const resp = await client.get("/objects/items", {
      params: { id: deviceId, full: true },
      headers: {
        Cookie: cookieHeader(),
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${GPS_BASE_URL}/objects`,
        Accept: "application/json",
      },
    });
    const item = (resp.data?.data as Record<string, unknown>[])?.[0];
    const sensors: DeviceSensor[] = Array.isArray(item?.sensors) ? (item.sensors as DeviceSensor[]) : [];
    sensorCache.set(deviceId, sensors);
    return sensors;
  } catch (err) {
    logger.error({ err, deviceId }, "Failed to fetch device sensors");
    return [];
  }
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


/**
 * @deprecated Remove this function — kept only for reference, do not call.
 * @internal
 */
async function _unusedProbeMonitoringPage(): Promise<Record<string, unknown>> {
  const ok = await ensureSession();
  if (!ok) return { error: "auth failed" };
  const client = createClient();
  const h = { Cookie: cookieHeader(), Accept: "text/html,application/json,*/*", Referer: `${GPS_BASE_URL}/history` };

  const results: Record<string, unknown> = {};

  // Load history page HTML to find form and CSRF
  try {
    const histPage = await client.get("/history", { headers: h });
    const histHtml = String(histPage.data || "");
    const csrf = histHtml.match(/name="_token"\s+(?:type="hidden"\s+)?value="([^"]+)"/)?.[1] ?? "";
    results["histPageStatus"] = histPage.status;
    results["histPageCsrf"] = csrf;
    // Find form action
    const formAction = histHtml.match(/<form[^>]*action="([^"]+)"/gi)?.map(m => m.match(/action="([^"]+)"/)?.[1]) ?? [];
    results["formActions"] = formAction;
    // Find select/input names for dates and device
    const inputNames = [...histHtml.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    results["inputNames"] = [...new Set(inputNames)];
    // Find any select for device ID
    const deviceOptions = [...histHtml.matchAll(/value="(\d+)"[^>]*>([^<]{3,50})</g)].slice(0, 5).map(m => `${m[1]}: ${m[2]}`);
    results["deviceOptions"] = deviceOptions;

    // Try GET /history/positions with different date formats
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const fmtISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const fmtVE = (d: Date) => `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;

    const attempts: Array<Record<string, string>> = [
      // Format 1: ISO dates + device_id
      { device_id: "879", date_from: `${fmtISO(yesterday)} 00:00:00`, date_to: `${fmtISO(today)} 23:59:59`, _token: csrf },
      // Format 2: Venezuelan format
      { device_id: "879", date_from: fmtVE(yesterday), date_to: fmtVE(today), _token: csrf },
      // Format 3: timestamps
      { device_id: "879", from: String(Math.floor(yesterday.getTime()/1000)), to: String(Math.floor(today.getTime()/1000)), _token: csrf },
      // Format 4: just today
      { device_id: "879", date_from: fmtISO(today), date_to: fmtISO(today), _token: csrf },
      // Format 5: separate hour/min params
      { device_id: "879", date_from: fmtISO(yesterday), date_from_h: "00", date_from_m: "00", date_to: fmtISO(today), date_to_h: "23", date_to_m: "59", _token: csrf },
    ];

    const tryResults: Record<string, unknown> = {};
    for (let i = 0; i < attempts.length; i++) {
      // Try GET
      const rg = await client.get("/history/positions", {
        params: attempts[i],
        headers: { ...h, "X-Requested-With": "XMLHttpRequest" }
      }).catch(e => ({ status: "ERR", data: String(e) }));

      // Try POST
      const formData = new URLSearchParams(attempts[i]).toString();
      const rp = await client.post("/history/positions", formData, {
        headers: { ...h, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" }
      }).catch(e => ({ status: "ERR", data: String(e) }));

      const gBody = String(rg.data || "").replace(/<[^>]+>/g," ").replace(/\s+/g," ").substring(0,200);
      const pBody = String(rp.data || "").replace(/<[^>]+>/g," ").replace(/\s+/g," ").substring(0,200);
      tryResults[`attempt${i+1}_GET`] = { status: rg.status, body: gBody };
      tryResults[`attempt${i+1}_POST`] = { status: rp.status, body: pBody };
    }
    results["historyPositionsTries"] = tryResults;
  } catch (e) {
    results["historyPageError"] = String(e);
  }

  // Load app.js, find app.urls definition and history endpoint
  try {
    const jsResp = await client.get("/assets/js/app.js", { headers: h });
    const js = String(jsResp.data || "");
    results["jsLength"] = js.length;

    // Find app.urls object definition — it lists all backend URLs
    const appUrlsIdx = js.indexOf("app.urls=");
    if (appUrlsIdx !== -1) {
      results["appUrls"] = js.substring(appUrlsIdx, appUrlsIdx + 2000);
    }
    // Also try app.urls = { ... } format
    const appUrlsIdx2 = js.indexOf("app.urls =");
    if (appUrlsIdx2 !== -1) {
      results["appUrls2"] = js.substring(appUrlsIdx2, appUrlsIdx2 + 2000);
    }
    // Try t.urls = or e.urls =
    const urlsMatches = [...js.matchAll(/[a-z]\.urls\s*=\s*\{/g)];
    results["urlsAssignments"] = urlsMatches.map(m => js.substring(m.index!, m.index! + 1000));

    // Find all AJAX $.get / $.post calls in the JS
    const ajaxCalls: string[] = [];
    const ajaxRe = /\$\.(get|post|ajax)\s*\(\s*["']([^"']{3,60})["']/g;
    let am: RegExpExecArray | null;
    while ((am = ajaxRe.exec(js)) !== null) {
      ajaxCalls.push(`${am[1].toUpperCase()} ${am[2]}`);
    }
    results["ajaxCalls"] = [...new Set(ajaxCalls)];

    // Find all string literals that look like route paths
    const routePaths = [...js.matchAll(/["'](\/[a-zA-Z][a-zA-Z0-9_/-]{3,50})["']/g)]
      .map(m => m[1])
      .filter(u => !u.includes(".") || u.endsWith(".json"));
    results["routePaths"] = [...new Set(routePaths)].slice(0, 100);

    // History-specific search
    const histIdx = js.indexOf("history");
    const histContexts: string[] = [];
    let hi = 0;
    while ((hi = js.indexOf("/history", hi)) !== -1) {
      histContexts.push(js.substring(Math.max(0, hi - 20), hi + 80));
      hi += 5;
    }
    results["historyContexts"] = histContexts.slice(0, 20);

  } catch (e) {
    results["jsError"] = String(e);
  }

  // Probe history endpoints with proper date params
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const histPaths = [
    "/history/index",
    "/history/get_history",
    "/history/positions",
    "/history/show",
    "/history/data",
  ];
  const histResults: Record<string, unknown> = {};
  await Promise.all(histPaths.map(async (p) => {
    const params: Record<string, string> = {
      device_id: "879", id: "879",
      date_from: fmt(yesterday), date_to: fmt(today),
      from: fmt(yesterday), to: fmt(today), limit: "1"
    };
    const r = await client.get(p, {
      params,
      headers: { ...h, "X-Requested-With": "XMLHttpRequest" }
    }).catch(e => ({ status: "ERR", data: String(e) }));
    const body = typeof r.data === "string"
      ? r.data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").substring(0, 400)
      : JSON.stringify(r.data).substring(0, 400);
    histResults[p] = { status: r.status, body };
  }));
  results["historyEndpoints"] = histResults;

  return results;
}

export interface OfflineReportItem {
  id: string;
  name: string;
  plate: string;
  simNumber: string;
  model: string | null;
  lastConnection: string;
  daysOffline: number;
  category: "descanso" | "contacto" | "urgente";
  installationDate: string | null;
}

/**
 * Parses a GPS platform time string to a JS timestamp.
 * Handles formats: "DD-MM-YYYY HH:MM:SS AM/PM" and ISO-like strings.
 */
function parseGpsTime(timeStr: string): number | null {
  if (!timeStr) return null;
  // Format: "20-05-2026 10:05:32 AM"
  const ddmmyyyy = timeStr.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i
  );
  if (ddmmyyyy) {
    const [, dd, mm, yyyy, hh, min, ss, ampm] = ddmmyyyy;
    let hour = parseInt(hh, 10);
    if (ampm?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (ampm?.toUpperCase() === "AM" && hour === 12) hour = 0;
    const d = new Date(
      parseInt(yyyy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      hour,
      parseInt(min, 10),
      parseInt(ss, 10)
    );
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  const d = new Date(timeStr);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Returns the last-seen timestamp map for all devices.
 *
 * Primary: reuses the shared lastSeenTimesCache populated by fetchLivePositions
 * from items_json (which already runs on every connection poll). This covers
 * all devices that have ever had GPS data.
 *
 * Fallback: makes a fresh items_json request if the cache is still empty
 * (e.g. fetchLivePositions hasn't run yet).
 */
async function fetchAllDeviceLastSeenTimes(): Promise<Map<string, string>> {
  // ── Primary: reuse cache once the full 7-day lookback has been done ──────
  // NOTE: we do NOT gate on lastSeenTimesCache.size > 0, because fetchLivePositions
  // can populate the cache with only ~27 very-recent devices before this function runs,
  // which would cause us to skip the lookback and miss all recently-offline devices.
  if (fullLastSeenLookupDone) {
    logger.info({ count: lastSeenTimesCache.size }, "Using shared last-seen cache (lookback already done)");
    return new Map(lastSeenTimesCache);
  }

  // ── First call: items_json with 7-day lookback to capture recently offline devices ──
  const ok = await ensureSession();
  if (!ok) return new Map();
  const client = createClient();
  try {
    // Request all updates from the past 7 days (in seconds).
    // This captures devices like CAJA SECA that were active 20+ hours ago
    // but don't appear in the initial snapshot (time=0 returns only ~30 very-recent ones).
    const sevenDaysAgoSec = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const resp = await client.get("/objects/items_json", {
      params: { time: sevenDaysAgoSec },
      headers: {
        Cookie: cookieHeader(),
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${GPS_BASE_URL}/objects`,
        Accept: "application/json",
      },
    });
    const result = new Map<string, string>();
    if (resp.data?.items && Array.isArray(resp.data.items)) {
      const rawItems = resp.data.items as Record<string, unknown>[];
      for (const item of rawItems) {
        const id = String(item.id ?? "");
        // Use Math.max(timestamp, acktimestamp) — same logic as platform JS
        const gpsTime = String(item.time ?? "");
        const ts = Number(item.timestamp ?? 0);
        const ackTs = Number(item.acktimestamp ?? 0);
        const bestTs = Math.max(ts, ackTs);
        // Prefer formatted GPS time string; fall back to computing from unix timestamps
        let timeVal = gpsTime;
        if (!timeVal && bestTs > 0) {
          const d = new Date(bestTs * 1000);
          const hh = d.getHours();
          const ampm = hh >= 12 ? "PM" : "AM";
          const h12 = hh % 12 || 12;
          timeVal = `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()} ${String(h12).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")} ${ampm}`;
        }
        if (id && timeVal) {
          result.set(id, timeVal);
          lastSeenTimesCache.set(id, timeVal);
        }
      }
    }
    fullLastSeenLookupDone = true;
    logger.info({ count: result.size }, "Fetched device last-seen times (7-day lookback)");
    return result;
  } catch (err) {
    logger.error({ err }, "Failed to fetch device last-seen times");
    return new Map();
  }
}

// Typed lookup from Excel export (IMEI → last-seen time string)
const excelLookup = deviceLastSeenRaw as {
  byImei: Record<string, string>;
  byPlate: Record<string, string>;
  generatedAt: string;
};

/**
 * Returns all offline/disconnected devices with category based on days offline.
 * Category: descanso (1-2d), contacto (3-7d), urgente (7+d).
 *
 * Last-seen priority:
 *  1. Excel export lookup (byImei, then byPlate) — covers all 476 platform devices
 *  2. Live items_json 7-day lookback (from fetchAllDeviceLastSeenTimes)
 *  3. installationDate fallback (shows "Sin datos" in UI)
 */
export async function fetchOfflineReport(): Promise<OfflineReportItem[]> {
  const [devices, liveLastSeen] = await Promise.all([
    fetchDevices(),
    fetchAllDeviceLastSeenTimes(),
  ]);

  const disconnected = devices.filter(
    (d) => d.status === "disconnected_blue" || d.status === "disconnected_red"
  );

  const now = Date.now();
  const result: OfflineReportItem[] = [];

  for (const device of disconnected) {
    // 1. Excel export lookup (most complete — covers all devices including long-offline ones)
    const excelTime =
      (device.imei ? excelLookup.byImei[device.imei] : undefined) ??
      (device.plate ? excelLookup.byPlate[device.plate] : undefined) ??
      "";

    // 2. Live 7-day items_json lookback
    const liveTime = liveLastSeen.get(device.id) ?? "";

    // Pick most recent between excel and live sources
    const excelMs = parseGpsTime(excelTime);
    const liveMs = parseGpsTime(liveTime);
    let realGpsTime = "";
    if (excelMs !== null && liveMs !== null) {
      realGpsTime = excelMs >= liveMs ? excelTime : liveTime;
    } else if (excelMs !== null) {
      realGpsTime = excelTime;
    } else if (liveMs !== null) {
      realGpsTime = liveTime;
    }

    // For daysOffline/category: use GPS time if available, else fall back to installationDate
    const timeForCalc = realGpsTime || device.lastConnection;
    const lastSeenMs = parseGpsTime(timeForCalc);
    const daysOffline =
      lastSeenMs != null ? Math.floor((now - lastSeenMs) / 86_400_000) : -1;

    let category: "descanso" | "contacto" | "urgente";
    if (daysOffline < 0) category = "urgente";
    else if (daysOffline <= 2) category = "descanso";
    else if (daysOffline <= 7) category = "contacto";
    else category = "urgente";

    result.push({
      id: device.id,
      name: device.name,
      plate: device.plate,
      simNumber: device.simNumber,
      model: device.model,
      // Empty string when no GPS time available → frontend shows "Sin datos"
      lastConnection: realGpsTime,
      daysOffline,
      category,
      installationDate: device.lastConnection || null,
    });
  }

  // Sort: most urgent first, then by days offline descending
  return result.sort((a, b) => {
    const order = { urgente: 0, contacto: 1, descanso: 2 };
    if (order[a.category] !== order[b.category])
      return order[a.category] - order[b.category];
    return b.daysOffline - a.daysOffline;
  });
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
