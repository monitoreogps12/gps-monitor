/**
 * Bot de Soporte Técnico — GPS SISTEMA C.A.
 * Acceso completo a flota, alertas críticas y reportes técnicos.
 */
import { Telegraf, Markup, type Context } from "telegraf";
import type { ParseMode, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, ForceReply } from "telegraf/types";
import { fetchDevices, fetchFleetStats, type GpsDevice } from "../lib/gps-service";
import { logger } from "../lib/logger";

const TOKEN = process.env["TELEGRAM_SUPPORT_BOT_TOKEN"] ?? "";
const CRITICAL_DAYS = 7;

// ─── Proactive alert interface ─────────────────────────────────────────────
// Allows other modules to send alerts via the support bot to admin operators.
const ADMIN_CHAT_IDS: string[] = (process.env["TELEGRAM_SUPPORT_ADMIN_CHAT_IDS"] ?? "").split(",").map(s => s.trim()).filter(Boolean);

let _supportBot: import("telegraf").Telegraf | null = null;

/**
 * Sends a message to all configured admin chat IDs via the support bot.
 * Used for proactive system alerts (e.g. low GSM signal).
 */
export async function sendSupportBotAlert(text: string): Promise<void> {
  if (!_supportBot || ADMIN_CHAT_IDS.length === 0) return;
  for (const chatId of ADMIN_CHAT_IDS) {
    try {
      await _supportBot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" });
    } catch (err) {
      logger.warn({ err, chatId }, "Failed to send support bot alert");
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    case "ack": return "ACK / Encendido";
    case "engine_idle": return "Motor en Ralentí";
    case "disconnected_red": return "Sin Señal";
    case "disconnected_blue": return "Desconectado";
    default: return "Desconocido";
  }
}

function isDisc(s: string) { return s === "disconnected_blue" || s === "disconnected_red"; }

function parseDate(s: string): Date | null {
  if (!s || s === "N/A" || s === "Invalid Date") return null;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const m = s.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[4]!);
    if (m[7]!.toUpperCase() === "PM" && h < 12) h += 12;
    if (m[7]!.toUpperCase() === "AM" && h === 12) h = 0;
    return new Date(parseInt(m[3]!), parseInt(m[2]!) - 1, parseInt(m[1]!), h, parseInt(m[5]!), parseInt(m[6]!));
  } catch { return null; }
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function durationStr(days: number | null): string {
  if (days === null) return "?";
  if (days === 0) return "hoy";
  if (days === 1) return "1 día";
  return `${days} días`;
}

function fechaVE() {
  return new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" }).replace(",", "");
}

type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
interface ReplyExtra { parse_mode?: ParseMode; reply_markup?: ReplyMarkup }

async function sendLong(ctx: Context, text: string, extra?: ReplyExtra) {
  const MAX = 4000;
  if (text.length <= MAX) { await ctx.reply(text, extra); return; }
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > MAX) { chunks.push(cur); cur = line; }
    else { cur = cur ? cur + "\n" + line : line; }
  }
  if (cur) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    const opts: ReplyExtra = i === chunks.length - 1 ? (extra ?? { parse_mode: "Markdown" }) : { parse_mode: "Markdown" };
    await ctx.reply(chunks[i]!, opts);
  }
}

function getText(ctx: Context): string {
  return (ctx.message as { text?: string } | undefined)?.text ?? "";
}

// ─── Menú principal ───────────────────────────────────────────────────────────

const MAIN_MENU = Markup.keyboard([
  ["📊 Dashboard", "🚨 Alertas Críticas"],
  ["🟢 En Movimiento", "🔴 Desconectados"],
  ["🔍 Buscar Vehículo", "📋 Flota Completa"],
  ["📨 Reporte Técnico", "❓ Ayuda"],
]).resize();

// ─── Shared logic ─────────────────────────────────────────────────────────────

async function searchAndReply(ctx: Context, q: string) {
  const query = q.toUpperCase().trim();
  if (!query) {
    await ctx.reply(
      `🔍 *Búsqueda de Vehículos*\n\n` +
      `Escribe directamente la placa, nombre o IMEI, o usa:\n` +
      `/buscar TEXTO\n\n` +
      `Ejemplos:\n` +
      `• \`ABC-1234\`\n` +
      `• \`/buscar TOYOTA\`\n` +
      `• \`/estado ABC-1234\`  — ficha técnica completa`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
    return;
  }

  try {
    const devices = await fetchDevices();
    const results = devices.filter((d) =>
      d.plate.toUpperCase().includes(query) ||
      d.name.toUpperCase().includes(query) ||
      d.imei.includes(query) ||
      d.simNumber.includes(query)
    );

    if (results.length === 0) {
      await ctx.reply(
        `❌ No encontré *"${q}"* en la flota.\n\n` +
        `Intenta con:\n• Placa completa o parcial\n• Nombre del vehículo\n• IMEI parcial`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    // Single result — show full detail directly
    if (results.length === 1) {
      await sendDetailCard(ctx, results[0]!);
      return;
    }

    // Multiple results — show list
    const lines = [`🔍 *"${q}"* — ${results.length} resultado(s)\n`];
    results.slice(0, 12).forEach((d) => {
      const days = daysSince(parseDate(d.lastConnection));
      const vel = d.status === "moving" && (d.speed ?? 0) > 0 ? ` · *${d.speed} km/h*` : "";
      lines.push(`${stEmoji(d.status)} *${d.plate || d.name}*${vel}`);
      lines.push(`   ${stLabel(d.status)} · ${d.lastConnection}${days !== null ? ` (${durationStr(days)})` : ""}`);
      lines.push(`   ➡️ /estado\\_${(d.plate || d.name.split(" ")[0]!).replace(/[- ]/g, "_")}`);
      lines.push("");
    });
    if (results.length > 12) lines.push(`_...y ${results.length - 12} más. Refina la búsqueda._`);

    await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
  } catch (err) {
    logger.error({ err }, "Search error");
    await ctx.reply("⚠️ Error al buscar. Intenta de nuevo.", MAIN_MENU);
  }
}

async function sendDetailCard(ctx: Context, d: GpsDevice) {
  const days = daysSince(parseDate(d.lastConnection));
  const lines = [
    `${stEmoji(d.status)} *${d.plate || d.name}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📌 *Placa:* ${d.plate || "N/A"}`,
    `🚘 *Nombre:* ${d.name}`,
    `🆔 *ID Sistema:* \`${d.id}\``,
    ``,
    `📡 *Estado:* ${stEmoji(d.status)} ${stLabel(d.status)}`,
    d.status === "moving" && d.speed !== null ? `🚀 *Velocidad:* *${d.speed} km/h*${(d.speed ?? 0) > 90 ? " ⚠️ EXCESO" : ""}` : "",
    d.driver ? `👤 *Conductor:* ${d.driver}` : "",
    ``,
    `🔧 *IMEI:* \`${d.imei}\``,
    `📱 *SIM:* ${d.simNumber}`,
    d.model ? `🖥️ *Modelo:* ${d.model}` : "",
    ``,
    `🕐 *Última conexión:* ${d.lastConnection}`,
    days !== null ? `⏱️ *Tiempo:* ${durationStr(days)}${days >= CRITICAL_DAYS ? " 🚨 CRÍTICO" : days === 0 ? " ✅" : ""}` : "",
    `━━━━━━━━━━━━━━━━━━━━`,
  ].filter(Boolean);

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });

  if (d.lat && d.lng) {
    await ctx.reply(`📍 Última posición conocida — *${d.plate || d.name}*`, { parse_mode: "Markdown" });
    await ctx.replyWithLocation(d.lat, d.lng);
    await ctx.reply(
      `[🗺️ Ver en Google Maps](https://maps.google.com/?q=${d.lat},${d.lng})`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  } else {
    await ctx.reply("📍 Posición GPS no disponible.", MAIN_MENU);
  }
}

// ─── Resilient launcher ───────────────────────────────────────────────────────

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

export function startSupportBot(): import("telegraf").Telegraf | null {
  if (!TOKEN) {
    logger.warn("TELEGRAM_SUPPORT_BOT_TOKEN not set — support bot disabled");
    return null;
  }

  const bot = new Telegraf(TOKEN);
  _supportBot = bot;

  // /start & /help ─────────────────────────────────────────────────────────
  bot.start(async (ctx: Context) => {
    const name = ctx.from?.first_name ?? "Técnico";
    try {
      const [stats, devices] = await Promise.all([fetchFleetStats(), fetchDevices()]);
      const critical = devices.filter((d) => isDisc(d.status) && (daysSince(parseDate(d.lastConnection)) ?? 0) >= CRITICAL_DAYS).length;
      const speeders = devices.filter((d) => d.status === "moving" && (d.speed ?? 0) > 90).length;
      const activos = stats.moving + stats.ack + stats.engineIdle;

      const alertLine = critical > 0 || speeders > 0
        ? `\n🚨 *Alertas:* ${critical > 0 ? `${critical} críticos` : ""}${critical > 0 && speeders > 0 ? " · " : ""}${speeders > 0 ? `${speeders} a exceso de vel.` : ""}`
        : "\n✅ Sin alertas activas.";

      await ctx.reply(
        `🛰️ *GPS SISTEMA C.A. — Centro de Control*\n` +
        `Bienvenido, *${name}*.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🚗 *Flota:* ${stats.total} vehículos\n` +
        `🟢 En movimiento: *${stats.moving}*   🟡 ACK: *${stats.ack}*\n` +
        `🟠 Ralentí: *${stats.engineIdle}*   🔴 Desconectados: *${stats.disconnected}*\n` +
        `📶 Actividad: *${stats.total > 0 ? Math.round((activos / stats.total) * 100) : 0}%*` +
        alertLine + `\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 *Tip:* Escribe directamente una placa o nombre para buscarlo.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
    } catch {
      await ctx.reply(
        `🛰️ *GPS SISTEMA C.A. — Centro de Control*\n` +
        `Bienvenido, *${name}*. Usa el menú para navegar.\n\n` +
        `💡 *Tip:* Escribe directamente una placa para buscarlo.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
    }
  });

  // /ping — health check rápido ─────────────────────────────────────────────
  bot.command("ping", async (ctx: Context) => {
    const t0 = Date.now();
    try {
      const stats = await fetchFleetStats();
      const ms = Date.now() - t0;
      await ctx.reply(
        `✅ *Online* · ${ms}ms\n🚗 Flota: ${stats.total} · 🟢 ${stats.moving} activos · 🔴 ${stats.disconnected} desc.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
    } catch {
      await ctx.reply(`⚠️ Error de conexión con la plataforma.`, MAIN_MENU);
    }
  });

  // 📊 Dashboard ─────────────────────────────────────────────────────────────
  const showDashboard = async (ctx: Context) => {
    try {
      const [stats, devices] = await Promise.all([fetchFleetStats(), fetchDevices()]);

      const critical = devices.filter((d) => {
        if (!isDisc(d.status)) return false;
        const days = daysSince(parseDate(d.lastConnection));
        return days !== null && days >= CRITICAL_DAYS;
      });

      const speeders = devices.filter((d) => d.status === "moving" && (d.speed ?? 0) > 90);
      const activos = stats.moving + stats.ack + stats.engineIdle;
      const activityPct = stats.total > 0 ? Math.round((activos / stats.total) * 100) : 0;

      const lines = [
        `📊 *DASHBOARD — GPS SISTEMA C.A.*`,
        `_🕐 ${fechaVE()}_\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚗 *Flota total:* ${stats.total} vehículos`,
        `📶 *Actividad:* ${activityPct}%   (${activos} de ${stats.total} activos)`,
        `━━━━━━━━━━━━━━━━━━━━\n`,
        `🟢 En movimiento:   *${stats.moving}*`,
        `🟡 ACK / Encendidos: *${stats.ack}*`,
        `🟠 Motor en Ralentí: *${stats.engineIdle}*`,
        `🔴 Desconectados:    *${stats.disconnected}*\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚨 *Alertas activas:*`,
        `   ⚡ Velocidad >90 km/h: *${speeders.length}*`,
        `   🔴 +${CRITICAL_DAYS} días sin conexión: *${critical.length}*`,
        `━━━━━━━━━━━━━━━━━━━━`,
      ];

      if (speeders.length > 0) {
        lines.push(`\n⚡ *Exceso de velocidad ahora:*`);
        speeders.slice(0, 5).forEach((d) => {
          lines.push(`   🚗 *${d.plate || d.name}* — *${d.speed} km/h*${(d.speed ?? 0) > 120 ? " 🚨🚨" : " ⚠️"}`);
          if (d.lat && d.lng) lines.push(`   📍 [Ver ubicación](https://maps.google.com/?q=${d.lat},${d.lng})`);
        });
        if (speeders.length > 5) lines.push(`   _...y ${speeders.length - 5} más_`);
      }

      if (critical.length > 0) {
        lines.push(`\n🔴 *Críticos más antiguos:*`);
        critical
          .sort((a, b) => (daysSince(parseDate(b.lastConnection)) ?? 0) - (daysSince(parseDate(a.lastConnection)) ?? 0))
          .slice(0, 4)
          .forEach((d) => {
            const days = daysSince(parseDate(d.lastConnection));
            lines.push(`   ${stEmoji(d.status)} *${d.plate || d.name}* — ${durationStr(days)} sin señal`);
          });
        if (critical.length > 4) lines.push(`   _...y ${critical.length - 4} más. Usa 🚨 Alertas Críticas._`);
      }

      lines.push(`\n_Actualizado: ${fechaVE()}_`);

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Dashboard error");
      await ctx.reply("⚠️ Error al obtener datos. Intenta de nuevo.", MAIN_MENU);
    }
  };

  bot.hears("📊 Dashboard", showDashboard);
  bot.command("dashboard", showDashboard);
  bot.command("estadisticas", showDashboard);
  bot.command("inicio", showDashboard);

  // 🚨 Alertas Críticas ──────────────────────────────────────────────────────
  const showAlerts = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();

      const critical = devices.filter((d) => {
        if (!isDisc(d.status)) return false;
        const days = daysSince(parseDate(d.lastConnection));
        return days !== null && days >= CRITICAL_DAYS;
      }).sort((a, b) => (daysSince(parseDate(b.lastConnection)) ?? 0) - (daysSince(parseDate(a.lastConnection)) ?? 0));

      const speeders = devices.filter((d) => d.status === "moving" && (d.speed ?? 0) > 90);

      if (critical.length === 0 && speeders.length === 0) {
        await ctx.reply(
          "✅ *Sin alertas activas.*\nTodos los vehículos operan con normalidad.",
          { parse_mode: "Markdown", ...MAIN_MENU }
        );
        return;
      }

      const lines = [
        `🚨 *ALERTAS ACTIVAS — GPS SISTEMA C.A.*`,
        `_${fechaVE()}_\n`,
      ];

      if (speeders.length > 0) {
        lines.push(`⚡ *Exceso de Velocidad — ${speeders.length} vehículo(s):*`);
        speeders.forEach((d) => {
          lines.push(`   🚗 *${d.plate || d.name}* — *${d.speed} km/h*${(d.speed ?? 0) > 120 ? " 🚨🚨" : " ⚠️"}`);
          if (d.lat && d.lng) lines.push(`   📍 [Mapa](https://maps.google.com/?q=${d.lat},${d.lng})`);
          lines.push(`   🔍 /estado\\_${(d.plate || d.name.split(" ")[0]!).replace(/[- ]/g, "_")}`);
        });
        lines.push("");
      }

      if (critical.length > 0) {
        lines.push(`━━━━━━━━━━━━━━━━━━━━`);
        lines.push(`🔴 *Sin conexión +${CRITICAL_DAYS} días — ${critical.length} vehículo(s):*\n`);
        critical.slice(0, 25).forEach((d) => {
          const days = daysSince(parseDate(d.lastConnection));
          lines.push(`${stEmoji(d.status)} *${d.plate || d.name}*${days !== null && days >= 30 ? " 🚨" : ""}`);
          lines.push(`   ⏱️ *${durationStr(days)}* sin conexión`);
          lines.push(`   IMEI: \`${d.imei}\` · SIM: ${d.simNumber}`);
          lines.push(`   🕐 Última: ${d.lastConnection}`);
          lines.push("");
        });
        if (critical.length > 25) lines.push(`_...y ${critical.length - 25} más_`);
      }

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Alerts error");
      await ctx.reply("⚠️ Error al obtener alertas.", MAIN_MENU);
    }
  };

  bot.hears("🚨 Alertas Críticas", showAlerts);
  bot.command("alertas", showAlerts);
  bot.command("criticos", showAlerts);

  // 🟢 En Movimiento ─────────────────────────────────────────────────────────
  const showMoving = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const moving = devices.filter((d) => d.status === "moving").sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));

      if (moving.length === 0) {
        await ctx.reply("ℹ️ No hay vehículos en movimiento en este momento.", MAIN_MENU);
        return;
      }

      const lines = [`🟢 *En Movimiento — ${moving.length} vehículos*\n_Ordenados por velocidad · ${fechaVE()}_\n`];
      moving.forEach((d, i) => {
        const sp = d.speed ?? 0;
        const speedWarn = sp > 120 ? " 🚨🚨" : sp > 90 ? " ⚠️" : "";
        lines.push(`*${i + 1}. ${d.plate || d.name}*`);
        lines.push(`   🚀 *${sp} km/h*${speedWarn}`);
        if (d.driver) lines.push(`   👤 ${d.driver}`);
        lines.push(`   🕐 ${d.lastConnection}`);
        if (d.lat && d.lng) lines.push(`   📍 [Ver en mapa](https://maps.google.com/?q=${d.lat},${d.lng})`);
        lines.push("");
      });

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Moving error");
      await ctx.reply("⚠️ Error al obtener datos.", MAIN_MENU);
    }
  };

  bot.hears("🟢 En Movimiento", showMoving);
  bot.command("movimiento", showMoving);
  bot.command("activos", showMoving);

  // 🔴 Desconectados ─────────────────────────────────────────────────────────
  const showDisc = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const disc = devices
        .filter((d) => isDisc(d.status))
        .map((d) => ({ ...d, days: daysSince(parseDate(d.lastConnection)) }))
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

      if (disc.length === 0) {
        await ctx.reply("✅ No hay vehículos desconectados. ¡Todo en línea!", MAIN_MENU);
        return;
      }

      const criticos = disc.filter((d) => (d.days ?? 0) >= CRITICAL_DAYS).length;
      const lines = [
        `🔴 *Desconectados — ${disc.length} vehículos*`,
        criticos > 0 ? `🚨 *${criticos} con más de ${CRITICAL_DAYS} días sin conexión*` : "",
        `_Ordenados por días sin conexión · ${fechaVE()}_\n`,
      ].filter(Boolean);

      disc.forEach((d) => {
        const crit = (d.days ?? 0) >= CRITICAL_DAYS;
        lines.push(`${stEmoji(d.status)} *${d.plate || d.name}*${crit ? " 🚨" : ""}`);
        lines.push(`   ⏱️ *${durationStr(d.days)}* sin conexión`);
        lines.push(`   IMEI: \`${d.imei}\` · SIM: ${d.simNumber}`);
        lines.push(`   🕐 Última: ${d.lastConnection}`);
        lines.push("");
      });

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Disconnected error");
      await ctx.reply("⚠️ Error al obtener datos.", MAIN_MENU);
    }
  };

  bot.hears("🔴 Desconectados", showDisc);
  bot.command("apagados", showDisc);
  bot.command("desconectados", showDisc);

  // 🔍 Buscar Vehículo ───────────────────────────────────────────────────────
  bot.hears("🔍 Buscar Vehículo", async (ctx: Context) => {
    await ctx.reply(
      `🔍 *Búsqueda de Vehículos*\n\n` +
      `Escribe directamente lo que buscas, o usa:\n\n` +
      `\`/buscar TEXTO\` — busca por placa, nombre o IMEI\n` +
      `\`/estado PLACA\` — ficha técnica completa + ubicación\n\n` +
      `_Ejemplo: \`/buscar TOYOTA\` o simplemente escribe_ \`ABC-1234\``,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  });

  bot.command("buscar", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim();
    await searchAndReply(ctx, q);
  });

  // /estado ──────────────────────────────────────────────────────────────────
  bot.command("estado", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase()
      .replace(/_/g, " ").replace(/-/g, "").trim();
    if (!q) {
      await ctx.reply("Uso: `/estado PLACA`\nEjemplo: `/estado ABC123`", { parse_mode: "Markdown" });
      return;
    }
    try {
      const devices = await fetchDevices();
      const d = devices.find((dev) =>
        dev.plate.toUpperCase().replace(/-/g,"").includes(q.replace(/-/g,"")) ||
        dev.name.toUpperCase().includes(q) ||
        dev.id === q
      );
      if (!d) {
        await ctx.reply(`❌ No encontré *"${q}"* en la flota.\nUsa /buscar para una búsqueda más amplia.`, { parse_mode: "Markdown", ...MAIN_MENU });
        return;
      }
      await sendDetailCard(ctx, d);
    } catch (err) {
      logger.error({ err }, "Estado error");
      await ctx.reply("⚠️ Error al obtener datos.", MAIN_MENU);
    }
  });

  // /ubicacion ───────────────────────────────────────────────────────────────
  bot.command("ubicacion", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase();
    if (!q) {
      await ctx.reply("Uso: `/ubicacion PLACA`\nEjemplo: `/ubicacion ABC123`", { parse_mode: "Markdown" });
      return;
    }
    try {
      const devices = await fetchDevices();
      const d = devices.find((dev) =>
        dev.plate.toUpperCase().includes(q) || dev.name.toUpperCase().includes(q)
      );
      if (!d) { await ctx.reply(`❌ No encontré *"${q}"*.`, { parse_mode: "Markdown", ...MAIN_MENU }); return; }
      if (!d.lat || !d.lng) {
        await ctx.reply(`⚠️ *${d.plate || d.name}* ${stEmoji(d.status)} ${stLabel(d.status)}\n\n📍 Posición GPS no disponible.`, { parse_mode: "Markdown", ...MAIN_MENU });
        return;
      }
      await ctx.reply(`📍 *${d.plate || d.name}* — ${stEmoji(d.status)} ${stLabel(d.status)}${d.speed ? ` · ${d.speed} km/h` : ""}`, { parse_mode: "Markdown" });
      await ctx.replyWithLocation(d.lat, d.lng);
      await ctx.reply(`[🗺️ Abrir en Google Maps](https://maps.google.com/?q=${d.lat},${d.lng})`, { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Ubicacion error");
      await ctx.reply("⚠️ Error al obtener ubicación.", MAIN_MENU);
    }
  });

  // 📋 Flota Completa ────────────────────────────────────────────────────────
  const showAll = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const groups: Record<string, GpsDevice[]> = {
        moving: [], ack: [], engine_idle: [], disconnected_red: [], disconnected_blue: [],
      };
      for (const d of devices) {
        const key = d.status in groups ? d.status : "disconnected_blue";
        groups[key]!.push(d);
      }

      const lines = [
        `📋 *FLOTA COMPLETA — ${devices.length} vehículos*`,
        `_${fechaVE()}_\n`,
        `🟢 En movimiento:   *${groups["moving"]!.length}*`,
        `🟡 ACK/Encendidos:  *${groups["ack"]!.length}*`,
        `🟠 Motor Ralentí:   *${groups["engine_idle"]!.length}*`,
        `🔴 Sin señal:       *${groups["disconnected_red"]!.length}*`,
        `🔵 Desconectados:   *${groups["disconnected_blue"]!.length}*\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
      ];

      const order: [string, string][] = [
        ["moving", "🟢 En Movimiento"],
        ["ack", "🟡 ACK / Encendidos"],
        ["engine_idle", "🟠 Motor en Ralentí"],
        ["disconnected_red", "🔴 Sin Señal GPS"],
        ["disconnected_blue", "🔵 Desconectados"],
      ];

      for (const [status, label] of order) {
        const list = groups[status]!;
        if (list.length === 0) continue;
        lines.push(`\n${label} (${list.length}):`);
        list.slice(0, 25).forEach((d) => {
          const sp = status === "moving" && (d.speed ?? 0) > 0 ? ` — ${d.speed}km/h${(d.speed ?? 0) > 90 ? "⚠️" : ""}` : "";
          lines.push(`   • *${d.plate || d.name}*${sp}`);
        });
        if (list.length > 25) lines.push(`   _...y ${list.length - 25} más_`);
      }

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "FlotaCompleta error");
      await ctx.reply("⚠️ Error al obtener la flota.", MAIN_MENU);
    }
  };

  bot.hears("📋 Flota Completa", showAll);
  bot.command("todos", showAll);
  bot.command("flota", showAll);

  // 📨 Reporte Técnico ───────────────────────────────────────────────────────
  const sendReport = async (ctx: Context) => {
    try {
      await ctx.reply("⏳ *Generando reporte técnico...*", { parse_mode: "Markdown" });
      const [devices, stats] = await Promise.all([fetchDevices(), fetchFleetStats()]);

      const critical = devices.filter((d) => {
        if (!isDisc(d.status)) return false;
        const days = daysSince(parseDate(d.lastConnection));
        return days !== null && days >= CRITICAL_DAYS;
      }).sort((a, b) => (daysSince(parseDate(b.lastConnection)) ?? 0) - (daysSince(parseDate(a.lastConnection)) ?? 0));

      const speeders = devices.filter((d) => d.status === "moving" && (d.speed ?? 0) > 90);
      const activos = stats.moving + stats.ack + stats.engineIdle;
      const activityPct = stats.total > 0 ? Math.round((activos / stats.total) * 100) : 0;

      // Group disconnected by severity
      const disc30 = devices.filter((d) => isDisc(d.status) && (daysSince(parseDate(d.lastConnection)) ?? 0) >= 30).length;
      const disc7 = critical.length - disc30;

      const lines = [
        `📊 *REPORTE TÉCNICO — GPS SISTEMA C.A.*`,
        `📅 ${fechaVE()}\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📈 *RESUMEN EJECUTIVO*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Total flota: *${stats.total}* vehículos`,
        `Índice de actividad: *${activityPct}%*\n`,
        `🟢 En movimiento:    *${stats.moving}*`,
        `🟡 ACK / Encendidos: *${stats.ack}*`,
        `🟠 Motor en Ralentí: *${stats.engineIdle}*`,
        `🔴 Desconectados:    *${stats.disconnected}*\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚨 *ALERTAS*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `⚡ Exceso de velocidad (>90 km/h): *${speeders.length}*`,
        `🔴 Sin conexión ${CRITICAL_DAYS}-29 días: *${disc7}*`,
        `🔴 Sin conexión +30 días: *${disc30}*`,
        `🔴 Total críticos: *${critical.length}*\n`,
      ];

      if (speeders.length > 0) {
        lines.push(`⚡ *Vehículos en exceso de velocidad:*`);
        speeders.forEach((d) => lines.push(`   • *${d.plate || d.name}* — *${d.speed} km/h*`));
        lines.push("");
      }

      if (critical.length > 0) {
        lines.push(`🔴 *Vehículos críticos (top ${Math.min(critical.length, 20)}):*`);
        critical.slice(0, 20).forEach((d) => {
          const days = daysSince(parseDate(d.lastConnection));
          lines.push(`   • *${d.plate || d.name}* — ${durationStr(days)}${days !== null && days >= 30 ? " 🚨" : ""}`);
          lines.push(`     IMEI: \`${d.imei}\``);
        });
        if (critical.length > 20) lines.push(`   _...y ${critical.length - 20} más_`);
        lines.push("");
      }

      lines.push(`━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`_Reporte generado automáticamente_`);
      lines.push(`_GPS SISTEMA C.A. · rastreoplus247.com_`);

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Report error");
      await ctx.reply("⚠️ Error al generar el reporte.", MAIN_MENU);
    }
  };

  bot.hears("📨 Reporte Técnico", sendReport);
  bot.command("reporte", sendReport);

  // ❓ Ayuda ─────────────────────────────────────────────────────────────────
  const showHelp = async (ctx: Context) => {
    await ctx.reply(
      `🛰️ *GPS SISTEMA C.A. — Guía de Comandos*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `*📊 Monitoreo General*\n` +
      `/dashboard — Resumen ejecutivo con alertas\n` +
      `/reporte — Reporte técnico completo\n` +
      `/alertas — Alertas activas (velocidad + críticos)\n` +
      `/ping — Verificar conexión con la plataforma\n\n` +
      `*🚗 Estado de Flota*\n` +
      `/movimiento — Vehículos en movimiento\n` +
      `/desconectados — Vehículos sin señal\n` +
      `/flota — Toda la flota agrupada por estado\n\n` +
      `*🔍 Vehículo específico*\n` +
      `/buscar TEXTO — Por placa, nombre o IMEI\n` +
      `/estado PLACA — Ficha técnica + ubicación\n` +
      `/ubicacion PLACA — Solo la posición en mapa\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *Tip rápido:* Escribe directamente una placa o nombre y el bot la buscará automáticamente.\n\n` +
      `_Datos en vivo · rastreoplus247.com_`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  };

  bot.hears("❓ Ayuda", showHelp);
  bot.command("ayuda", showHelp);
  bot.command("help", showHelp);

  // ─── Catch-all inteligente ────────────────────────────────────────────────
  // Si el usuario escribe texto que no es un comando ni un botón,
  // se trata como una búsqueda de vehículo directa.
  bot.on("text", async (ctx: Context) => {
    const text = getText(ctx).trim();
    // Ignore commands (already handled above)
    if (text.startsWith("/")) return;

    // Try to detect if it looks like a plate / name search
    if (text.length >= 3) {
      await ctx.reply(`🔍 Buscando _"${text}"_ en la flota...`, { parse_mode: "Markdown" });
      await searchAndReply(ctx, text);
    } else {
      await ctx.reply(
        "No entendí ese mensaje.\n\nEscribe una *placa*, *nombre* o *IMEI* para buscarlo, o usa el menú.",
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
    }
  });

  // ─── Webhook setup (production) / polling fallback (dev) ─────────────────
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  if (domain) {
    const webhookUrl = `https://${domain}/api/bot/support`;
    void bot.telegram.setWebhook(webhookUrl)
      .then(() => logger.info({ webhookUrl }, "Support bot webhook set"))
      .catch((err: unknown) => logger.error({ err }, "Failed to set support bot webhook"));
  } else {
    void launchWithRetry(bot, "support");
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return bot;
}
