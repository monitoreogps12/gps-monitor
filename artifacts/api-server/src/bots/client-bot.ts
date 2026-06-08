import { Telegraf, Markup, type Context } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchDevices, fetchLivePositions, type GpsDevice, type LivePosition } from "../lib/gps-service";
import { logger } from "../lib/logger";
import { startNotificationService } from "./notifications";

const TOKEN = process.env["TELEGRAM_CLIENT_BOT_TOKEN"] ?? "";

const MAIN_MENU = Markup.keyboard([
  ["🚗 Mis Vehículos", "📊 Resumen de Flota"],
  ["📍 Ver Ubicación",  "🔔 Mis Alertas"],
  ["❓ Ayuda"],
]).resize();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stEmoji(s: string) {
  switch (s) {
    case "moving":           return "🟢";
    case "ack":              return "🟡";
    case "engine_idle":      return "🟠";
    case "disconnected_red": return "🔴";
    case "disconnected_blue":return "🔵";
    default:                 return "⚪";
  }
}

function stLabel(s: string) {
  switch (s) {
    case "moving":           return "En Movimiento";
    case "ack":              return "ACK / Encendido";
    case "engine_idle":      return "Motor en Ralentí";
    case "disconnected_red": return "Sin Señal";
    case "disconnected_blue":return "Desconectado";
    default:                 return "Desconocido";
  }
}

function getFecha() {
  return new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" }).replace(",", "");
}

function sep() { return "─".repeat(28); }

// Combina datos del device (metadatos) con la posición en vivo (lat/lng/estado)
// fetchDevices() nunca devuelve lat/lng — solo fetchLivePositions() los trae
function mergeWithLive(device: GpsDevice | undefined, live: LivePosition | undefined): GpsDevice | undefined {
  if (!device && !live) return undefined;
  if (!live) return device;
  return {
    id: live.id,
    name: live.name || device?.name || "",
    plate: live.plate || device?.plate || "",
    imei: device?.imei || live.imei || "",
    simNumber: device?.simNumber || live.simNumber || "",
    model: device?.model || live.model || null,
    status: live.status,
    speed: live.speed,
    lastConnection: live.lastConnection,
    lat: live.lat,
    lng: live.lng,
    address: live.address,
    driver: live.driver || device?.driver || null,
  };
}

async function getClient(chatId: string) {
  const rows = await db.select().from(clientsTable).where(eq(clientsTable.telegramId, chatId));
  return rows[0] ?? null;
}

async function requireClient(ctx: Context): Promise<Awaited<ReturnType<typeof getClient>>> {
  const client = await getClient(String(ctx.chat!.id));
  if (!client) {
    await ctx.reply(
      "❌ *No estás registrado.*\n\nUsa /start para comenzar.",
      { parse_mode: "Markdown" }
    );
  }
  return client;
}

// Envía ficha de vehículo + mapa nativo si tiene GPS
async function sendVehicleCard(
  ctx: Context,
  vehicle: { plate: string; deviceName: string; deviceId: string },
  device: GpsDevice | undefined,
  extra?: object
) {
  if (!device) {
    await ctx.reply(
      `⚠️ *${vehicle.plate || vehicle.deviceName}*\n\nSin datos recientes en la plataforma.`,
      { parse_mode: "Markdown", ...(extra ?? MAIN_MENU) }
    );
    return;
  }

  const hasGps = !!(device.lat && device.lng);
  const mapsLink = hasGps
    ? `[📍 Ver en Google Maps](https://www.google.com/maps?q=${device.lat},${device.lng})`
    : null;

  const lines = [
    `${stEmoji(device.status)} *ESTADO DEL VEHÍCULO*`,
    sep(),
    `🔖 *Placa:*      ${vehicle.plate || device.plate || "—"}`,
    `🚘 *Vehículo:* ${device.name}`,
    `📡 *Estado:*    ${stLabel(device.status)}`,
    (device.speed ?? 0) > 0
      ? `🚀 *Velocidad:* *${device.speed} km/h*${(device.speed ?? 0) > 90 ? "  ⚠️" : ""}`
      : null,
    device.driver ? `👤 *Conductor:* ${device.driver}` : null,
    `🕒 *Consulta:*  ${getFecha()}`,
    `🕐 *Última:*     ${device.lastConnection || "N/A"}`,
    sep(),
    mapsLink ?? `📍 _Posición GPS no disponible_`,
    mapsLink ? `_(Ubicación adjunta abajo)_` : null,
  ].filter(Boolean).join("\n");

  await ctx.reply(lines, { parse_mode: "Markdown", ...(extra ?? MAIN_MENU) });

  if (hasGps) {
    await ctx.replyWithLocation(device.lat!, device.lng!);
  }
}

// ─── Resilient launcher (handles 409 conflicts and timeouts with retry) ──────

async function launchWithRetry(
  bot: Telegraf,
  name: string,
  attempt = 1,
): Promise<void> {
  const MAX_ATTEMPTS = 10;
  const BASE_DELAY_MS = 15_000;

  try {
    await bot.launch({ dropPendingUpdates: true });
    logger.info({ name }, "Telegram bot started");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const is409 = message.includes("409");
    const isTimeout = message.includes("timed out") || message.includes("TimeoutError");

    if ((is409 || isTimeout) && attempt <= MAX_ATTEMPTS) {
      const delay = Math.min(BASE_DELAY_MS * attempt, 5 * 60_000);
      logger.warn(
        { name, attempt, delayMs: delay, reason: is409 ? "409_conflict" : "timeout" },
        "Bot launch failed — will retry"
      );
      await new Promise((r) => setTimeout(r, delay));
      await launchWithRetry(bot, name, attempt + 1);
    } else {
      logger.error({ err, name, attempt }, "Bot launch failed permanently");
    }
  }
}

// ─── Bot ─────────────────────────────────────────────────────────────────────

export function startClientBot(): import("telegraf").Telegraf | null {
  if (!TOKEN) {
    logger.warn("TELEGRAM_CLIENT_BOT_TOKEN not set, client bot disabled");
    return null;
  }

  const bot = new Telegraf(TOKEN);

  // Botón para solicitar número de teléfono nativo de Telegram
  const CONTACT_BUTTON = Markup.keyboard([
    [Markup.button.contactRequest("📱 Compartir mi número de teléfono")],
  ]).resize().oneTime();

  // Lógica de registro compartida (usada tanto por contact como por /registrar)
  async function registerByPhone(
    ctx: Context,
    chatId: string,
    phone: string,
  ): Promise<void> {
    const normalised = phone.startsWith("+") ? phone : `+${phone}`;

    const byPhone = await db.select().from(clientsTable)
      .where(eq(clientsTable.phone, normalised));

    if (byPhone[0]) {
      await db.update(clientsTable)
        .set({ telegramId: chatId, telegramUsername: ctx.from?.username ?? null, isActive: true, updatedAt: new Date() })
        .where(eq(clientsTable.id, byPhone[0].id));
      await ctx.reply(
        `✅ *¡Cuenta vinculada exitosamente!*\n\n` +
        `Bienvenido, *${byPhone[0].name}*.\n\n` +
        `🔔 *Notificaciones automáticas activadas:*\n` +
        `   • 🟢 Encendido / Apagado\n` +
        `   • ⚠️ Exceso de velocidad (>90 km/h)\n` +
        `   • 🔄 Cambios de estado\n\n` +
        `Cada alerta incluye la ubicación en tiempo real.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    // No existe en la BD — registrar como nuevo
    const name = `${ctx.from?.first_name ?? ""} ${ctx.from?.last_name ?? ""}`.trim() || "Cliente";
    await db.insert(clientsTable).values({
      name, phone: normalised, telegramId: chatId, telegramUsername: ctx.from?.username ?? null,
    });
    await ctx.reply(
      `✅ *Registro exitoso*\n\n` +
      `Número *${normalised}* registrado.\n\n` +
      `Un técnico de *GPS SISTEMA C.A.* asignará tus vehículos en breve.\n` +
      `Una vez asignados, comenzarás a recibir notificaciones automáticas.`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  }

  // /start ─────────────────────────────────────────────────────────────────
  bot.start(async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const firstName = ctx.from?.first_name ?? "Cliente";
    const client = await getClient(chatId);

    if (client) {
      await ctx.reply(
        `✅ *¡Bienvenido de nuevo, ${client.name}!*\n\n` +
        `🔔 *Notificaciones automáticas activas:*\n` +
        `   • 🟢 Vehículo encendido\n` +
        `   • 🔴 Vehículo apagado / desconectado\n` +
        `   • ⚠️ Exceso de velocidad (>90 km/h)\n` +
        `   • 🔄 Cambios de estado\n\n` +
        `También puedes consultar el estado de tus vehículos en cualquier momento desde el menú.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    await ctx.reply(
      `👋 ¡Bienvenido a *GPS SISTEMA C.A.*, ${firstName}!\n\n` +
      `Para activar el monitoreo de tus vehículos necesito verificar tu número.\n\n` +
      `Toca el botón de abajo para compartirlo con un solo toque 👇`,
      { parse_mode: "Markdown", ...CONTACT_BUTTON }
    );
  });

  // Recibe el contacto compartido por Telegram ─────────────────────────────
  bot.on("contact", async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const contact = (ctx.message as { contact?: { phone_number?: string; user_id?: number } }).contact;

    if (!contact?.phone_number) {
      await ctx.reply("❌ No se pudo leer el número. Intenta de nuevo con /start.", MAIN_MENU);
      return;
    }

    // Verificar que el contacto compartido sea el del propio usuario
    if (contact.user_id && contact.user_id !== ctx.from?.id) {
      await ctx.reply(
        "❌ Por favor comparte *tu propio* número de teléfono, no el de un contacto.",
        { parse_mode: "Markdown", ...CONTACT_BUTTON }
      );
      return;
    }

    const existing = await getClient(chatId);
    if (existing) {
      await ctx.reply(
        `✅ Ya estás registrado como *${existing.name}*.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    await registerByPhone(ctx, chatId, contact.phone_number);
  });

  // /registrar (fallback manual) ────────────────────────────────────────────
  bot.command("registrar", async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const text = (ctx.message as { text: string }).text;
    const phone = text.split(" ").slice(1).join("").trim();

    if (!phone) {
      await ctx.reply(
        "❌ Debes indicar tu número.\n\nEjemplo: `/registrar +584147583683`\n\nO usa el botón de /start para compartirlo automáticamente.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const existing = await getClient(chatId);
    if (existing) {
      await ctx.reply(
        `✅ Ya estás registrado como *${existing.name}*.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    await registerByPhone(ctx, chatId, phone);
  });

  // 🚗 Mis Vehículos ────────────────────────────────────────────────────────
  const showVehicles = async (ctx: Context) => {
    const client = await requireClient(ctx);
    if (!client) return;

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) {
      await ctx.reply(
        "ℹ️ *Sin vehículos asignados*\n\nContacta a GPS SISTEMA C.A. para que asignen tus vehículos.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let devices: GpsDevice[] = [];
    let livePositions: LivePosition[] = [];
    try {
      [devices, livePositions] = await Promise.all([fetchDevices(), fetchLivePositions()]);
    } catch { /* usa cache vacío */ }

    const lines = [
      `🚗 *Mis Vehículos* — ${vehicles.length} unidad(es)\n`,
      sep(),
    ];

    for (const v of vehicles) {
      const d = devices.find((dev) => dev.id === v.deviceId);
      const live = livePositions.find((p) => p.id === v.deviceId);
      const merged = mergeWithLive(d, live);
      const plate = v.plate || merged?.plate || v.deviceId;
      const emoji = merged ? stEmoji(merged.status) : "⚪";
      const estado = merged ? stLabel(merged.status) : "Sin datos";
      const vel = merged?.speed && merged.speed > 0 ? ` · ${merged.speed} km/h${merged.speed > 90 ? " ⚠️" : ""}` : "";
      lines.push(`${emoji} *${plate}*  —  ${estado}${vel}`);
      lines.push(`   🕐 ${merged?.lastConnection || "N/A"}`);
      lines.push("");
    }

    lines.push(`_Para ver ubicación usa 📍 Ver Ubicación_`);

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
  };

  bot.hears("🚗 Mis Vehículos", showVehicles);
  bot.command("mis_vehiculos", showVehicles);

  // 📊 Resumen de Flota ─────────────────────────────────────────────────────
  const showResumen = async (ctx: Context) => {
    const client = await requireClient(ctx);
    if (!client) return;

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) {
      await ctx.reply("ℹ️ No tienes vehículos asignados.", MAIN_MENU);
      return;
    }

    let devices: GpsDevice[] = [];
    try { devices = await fetchDevices(); } catch { /* ignore */ }

    let moving = 0, encendido = 0, ralenti = 0, disconnected = 0, sinDatos = 0;
    for (const v of vehicles) {
      const d = devices.find((dev) => dev.id === v.deviceId);
      if (!d) { sinDatos++; continue; }
      if (d.status === "moving") moving++;
      else if (d.status === "ack") encendido++;
      else if (d.status === "engine_idle") ralenti++;
      else disconnected++;
    }

    const lines = [
      `📊 *RESUMEN DE MI FLOTA*`,
      sep(),
      `👤 *Cliente:*       ${client.name}`,
      `📅 *Consultado:* ${getFecha()}`,
      sep(),
      `🚗 *Total:*           ${vehicles.length} vehículo(s)`,
      `🟢 *En movimiento:*  ${moving}`,
      `🟡 *ACK/Encendido:* ${encendido}`,
      `🟠 *Ralentí:*         ${ralenti}`,
      `🔴 *Desconectados:* ${disconnected}`,
      sinDatos > 0 ? `⚪ *Sin datos:*       ${sinDatos}` : null,
      sep(),
      `🔔 *Notificaciones automáticas:* Activas`,
      `🚨 *Límite de velocidad:* 90 km/h`,
    ].filter(Boolean).join("\n");

    await ctx.reply(lines, { parse_mode: "Markdown", ...MAIN_MENU });
  };

  bot.hears("📊 Resumen de Flota", showResumen);
  bot.command("resumen", showResumen);

  // 📍 Ver Ubicación — muestra teclado con placas ───────────────────────────
  bot.hears("📍 Ver Ubicación", async (ctx: Context) => {
    const client = await requireClient(ctx);
    if (!client) return;

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) {
      await ctx.reply("ℹ️ No tienes vehículos asignados.", MAIN_MENU);
      return;
    }

    const buttons = vehicles.map((v) => [`🔍 ${v.plate || v.deviceName || v.deviceId}`]);
    await ctx.reply(
      "Selecciona el vehículo para ver su ubicación actual:",
      Markup.keyboard([...buttons, ["🔙 Volver al menú"]]).resize()
    );
  });

  // Selección desde teclado ─────────────────────────────────────────────────
  bot.hears(/^🔍 (.+)$/, async (ctx: Context) => {
    const client = await requireClient(ctx);
    if (!client) return;

    const match = (ctx.message as { text: string }).text.match(/^🔍 (.+)$/);
    const term = match?.[1]?.trim().toUpperCase() ?? "";
    if (!term) return;

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    const vehicle = vehicles.find((v) =>
      v.plate.toUpperCase().includes(term) ||
      v.deviceName.toUpperCase().includes(term) ||
      v.deviceId === term
    );

    if (!vehicle) {
      await ctx.reply("❌ Vehículo no encontrado.", MAIN_MENU);
      return;
    }

    try {
      const [devices, livePositions] = await Promise.all([fetchDevices(), fetchLivePositions()]);
      const device = devices.find((d) => d.id === vehicle.deviceId);
      const live = livePositions.find((p) => p.id === vehicle.deviceId);
      await sendVehicleCard(ctx, vehicle, mergeWithLive(device, live) ?? device, MAIN_MENU);
    } catch {
      await ctx.reply("⚠️ Error al consultar datos. Intenta de nuevo.", MAIN_MENU);
    }
  });

  // /ubicacion PLACA ────────────────────────────────────────────────────────
  bot.command("ubicacion", async (ctx: Context) => {
    const client = await requireClient(ctx);
    if (!client) return;

    const text = (ctx.message as { text: string }).text;
    const term = text.split(" ").slice(1).join(" ").trim().toUpperCase();
    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));

    if (!term) {
      const list = vehicles.map((v) => `   • ${v.plate || v.deviceName || v.deviceId}`).join("\n");
      await ctx.reply(
        `📍 *Ver ubicación de vehículo*\n\n` +
        `Uso: \`/ubicacion PLACA\`\n\n` +
        `Tus vehículos:\n${list || "_(sin asignar)_"}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const vehicle = vehicles.find((v) =>
      v.plate.toUpperCase().includes(term) || v.deviceName.toUpperCase().includes(term)
    );

    if (!vehicle) {
      await ctx.reply(`❌ No encontré un vehículo con "${term}".`);
      return;
    }

    try {
      const [devices, livePositions] = await Promise.all([fetchDevices(), fetchLivePositions()]);
      const device = devices.find((d) => d.id === vehicle.deviceId);
      const live = livePositions.find((p) => p.id === vehicle.deviceId);
      await sendVehicleCard(ctx, vehicle, mergeWithLive(device, live) ?? device);
    } catch {
      await ctx.reply("⚠️ Error al obtener datos.");
    }
  });

  // 🔔 Mis Alertas ───────────────────────────────────────────────────────────
  bot.hears("🔔 Mis Alertas", async (ctx: Context) => {
    await ctx.reply(
      `🔔 *Alertas Automáticas — GPS SISTEMA C.A.*\n` +
      sep() + "\n" +
      `Las siguientes alertas se envían *automáticamente* en tiempo real:\n\n` +
      `🟢 *Vehículo Encendido*\n` +
      `   Cuando pasa de desconectado a activo.\n\n` +
      `🔴 *Vehículo Apagado / Desconectado*\n` +
      `   Cuando pierde conexión con el GPS.\n\n` +
      `⚠️ *Exceso de Velocidad*\n` +
      `   Cuando supera los *90 km/h*.\n\n` +
      `🔄 *Cambio de Estado*\n` +
      `   Cambios entre modos encendido/ralentí/ACK.\n\n` +
      sep() + "\n" +
      `_Cada alerta incluye el enlace a Google Maps y la ubicación adjunta en Telegram._\n\n` +
      `No es necesario hacer nada — las recibirás de forma automática.`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  });

  // ─── Alias botones anteriores (compatibilidad hacia atrás) ────────────────
  // El usuario puede tener el teclado viejo cacheado en Telegram
  bot.hears("📊 Estado General", showResumen);
  bot.hears("📍 Ubicación de Vehículo", async (ctx: Context) => {
    // Redirigir al flujo nuevo de selección por placa
    const client = await requireClient(ctx);
    if (!client) return;
    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) { await ctx.reply("ℹ️ No tienes vehículos asignados.", MAIN_MENU); return; }
    const buttons = vehicles.map((v) => [`🔍 ${v.plate || v.deviceName || v.deviceId}`]);
    await ctx.reply("Selecciona el vehículo:", Markup.keyboard([...buttons, ["🔙 Volver al menú"]]).resize());
  });
  // Botón viejo de selección de placa (prefijo 📍)
  bot.hears(/^📍 (.+)$/, async (ctx: Context) => {
    const client = await requireClient(ctx);
    if (!client) return;
    const match = (ctx.message as { text: string }).text.match(/^📍 (.+)$/);
    const term = match?.[1]?.trim().toUpperCase() ?? "";
    if (!term) return;
    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    const vehicle = vehicles.find((v) =>
      v.plate.toUpperCase().includes(term) ||
      v.deviceName.toUpperCase().includes(term) ||
      v.deviceId === term
    );
    if (!vehicle) { await ctx.reply("❌ Vehículo no encontrado.", MAIN_MENU); return; }
    try {
      const devices = await fetchDevices();
      await sendVehicleCard(ctx, vehicle, devices.find((d) => d.id === vehicle.deviceId), MAIN_MENU);
    } catch {
      await ctx.reply("⚠️ Error al obtener datos.", MAIN_MENU);
    }
  });

  // 🔙 Volver ────────────────────────────────────────────────────────────────
  bot.hears("🔙 Volver al menú", async (ctx: Context) => {
    await ctx.reply("Menú principal:", MAIN_MENU);
  });
  bot.hears("🔙 Volver", async (ctx: Context) => {
    await ctx.reply("Menú principal:", MAIN_MENU);
  });

  // ❓ Ayuda ─────────────────────────────────────────────────────────────────
  const showHelp = async (ctx: Context) => {
    await ctx.reply(
      `❓ *GPS SISTEMA C.A. — Ayuda*\n` +
      sep() + "\n" +
      `*Consultas manuales:*\n` +
      `🚗 /mis_vehiculos — Lista y estado de tu flota\n` +
      `📊 /resumen — Resumen estadístico\n` +
      `📍 /ubicacion PLACA — Ver ubicación en tiempo real\n\n` +
      `*Registro:*\n` +
      `/registrar NÚMERO — Vincular tu cuenta\n\n` +
      sep() + "\n" +
      `🔔 *Las notificaciones automáticas están siempre activas.*\n` +
      `No necesitas hacer nada para recibirlas.\n\n` +
      `📞 *Soporte:* GPS SISTEMA C.A.`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  };

  bot.hears("❓ Ayuda", showHelp);
  bot.command("ayuda", showHelp);
  bot.command("help", showHelp);

  // ─── Catch-all: mensaje no reconocido ────────────────────────────────────
  bot.on("text", async (ctx: Context) => {
    await ctx.reply(
      "No entendí ese mensaje. Usa el menú o escribe /ayuda.",
      MAIN_MENU
    );
  });

  // Iniciar servicio de notificaciones automáticas ──────────────────────────
  startNotificationService(bot);

  // ─── Webhook setup (production) / polling fallback (dev) ─────────────────
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  if (domain) {
    const webhookUrl = `https://${domain}/api/bot/client`;
    void bot.telegram.setWebhook(webhookUrl)
      .then(() => logger.info({ webhookUrl }, "Client bot webhook set"))
      .catch((err: unknown) => logger.error({ err }, "Failed to set client bot webhook"));
  } else {
    void launchWithRetry(bot, "client");
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return bot;
}
