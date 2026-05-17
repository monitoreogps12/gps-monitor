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

// ─── Menus ───────────────────────────────────────────────────────────────────

const MAIN_MENU = Markup.keyboard([
  ["📊 Dashboard", "🚨 Alertas Críticas"],
  ["🟢 En Movimiento", "🔴 Desconectados"],
  ["🔍 Buscar", "📋 Flota Completa"],
  ["📨 Reporte Técnico", "⚙️ Más Opciones"],
]).resize();

const MORE_MENU = Markup.keyboard([
  ["🟡 ACK / Encendidos", "🟠 Motor Ralentí"],
  ["📍 Ubicación por Placa", "🗓️ Historial Reciente"],
  ["🏠 Menú Principal"],
]).resize();

// ─── Bot ─────────────────────────────────────────────────────────────────────

export function startSupportBot(): void {
  if (!TOKEN) {
    logger.warn("TELEGRAM_SUPPORT_BOT_TOKEN not set — support bot disabled");
    return;
  }

  const bot = new Telegraf(TOKEN);

  // /start ─────────────────────────────────────────────────────────────────
  bot.start(async (ctx: Context) => {
    const name = ctx.from?.first_name ?? "Técnico";
    await ctx.reply(
      `🛰️ *GPS SISTEMA C.A. — Centro de Control*\n\n` +
      `Bienvenido, *${name}*.\n` +
      `Tienes acceso técnico completo a la flota en tiempo real.\n\n` +
      `*Comandos rápidos:*\n` +
      `📊 /dashboard — Resumen ejecutivo\n` +
      `🔍 /buscar PLACA — Localizar vehículo\n` +
      `📍 /ubicacion PLACA — Ver en mapa\n` +
      `📨 /reporte — Reporte técnico completo\n` +
      `🚨 /criticos — Vehículos con +${CRITICAL_DAYS} días desconectados\n\n` +
      `_Datos en vivo · rastreoplus247.com_`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  });

  // 📊 Dashboard / /dashboard ──────────────────────────────────────────────
  const showDashboard = async (ctx: Context) => {
    try {
      const [stats, devices] = await Promise.all([fetchFleetStats(), fetchDevices()]);

      const critical = devices.filter((d) => {
        if (!isDisc(d.status)) return false;
        const days = daysSince(parseDate(d.lastConnection));
        return days !== null && days >= CRITICAL_DAYS;
      });

      const activeRatio = stats.total > 0
        ? Math.round(((stats.moving + stats.ack + stats.engineIdle) / stats.total) * 100)
        : 0;

      const speeders = devices.filter((d) => d.status === "moving" && (d.speed ?? 0) > 90);

      const lines = [
        `📊 *DASHBOARD — GPS SISTEMA C.A.*`,
        `_🕐 ${new Date().toLocaleString("es-VE")}_\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚗 *Flota total:* ${stats.total} vehículos`,
        `📶 *Actividad:* ${activeRatio}%`,
        `━━━━━━━━━━━━━━━━━━━━\n`,
        `🟢 En movimiento:   *${stats.moving}*`,
        `🟡 ACK/Encendidos: *${stats.ack}*`,
        `🟠 Ralentí:         *${stats.engineIdle}*`,
        `🔴 Desconectados:  *${stats.disconnected}*\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚨 *Alertas activas:*`,
        `   ⚠️ Velocidad >90 km/h: *${speeders.length}*`,
        `   🔴 +${CRITICAL_DAYS} días sin conexión: *${critical.length}*`,
        `━━━━━━━━━━━━━━━━━━━━`,
      ];

      if (speeders.length > 0) {
        lines.push(`\n🚨 *Exceso de velocidad ahora:*`);
        speeders.slice(0, 5).forEach((d) => {
          lines.push(`   • *${d.plate || d.name}* — ${d.speed} km/h`);
        });
      }

      if (critical.length > 0) {
        lines.push(`\n⚠️ *Críticos más antiguos:*`);
        critical
          .sort((a, b) => (daysSince(parseDate(b.lastConnection)) ?? 0) - (daysSince(parseDate(a.lastConnection)) ?? 0))
          .slice(0, 3)
          .forEach((d) => {
            const days = daysSince(parseDate(d.lastConnection));
            lines.push(`   • *${d.plate || d.name}* — ${durationStr(days)} sin conexión`);
          });
      }

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Dashboard error");
      await ctx.reply("⚠️ Error al obtener datos. Intenta de nuevo.", MAIN_MENU);
    }
  };

  bot.hears("📊 Dashboard", showDashboard);
  bot.command("dashboard", showDashboard);
  bot.command("estadisticas", showDashboard);

  // 🚨 Alertas Críticas ────────────────────────────────────────────────────
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
        await ctx.reply("✅ *Sin alertas activas.* Todos los vehículos funcionan con normalidad.", { parse_mode: "Markdown", ...MAIN_MENU });
        return;
      }

      const lines = [`🚨 *ALERTAS ACTIVAS — GPS SISTEMA C.A.*\n_${new Date().toLocaleString("es-VE")}_\n`];

      if (speeders.length > 0) {
        lines.push(`⚡ *Exceso de Velocidad (${speeders.length}):*`);
        speeders.forEach((d) => {
          lines.push(`   🚗 *${d.plate || d.name}* — *${d.speed} km/h*`);
          if (d.lat && d.lng) lines.push(`   📍 Coords: ${d.lat}, ${d.lng}`);
        });
        lines.push("");
      }

      if (critical.length > 0) {
        lines.push(`🔴 *Sin conexión +${CRITICAL_DAYS} días (${critical.length}):*`);
        critical.slice(0, 20).forEach((d) => {
          const days = daysSince(parseDate(d.lastConnection));
          lines.push(`   ${stEmoji(d.status)} *${d.plate || d.name}* — ${durationStr(days)}`);
          lines.push(`   IMEI: \`${d.imei}\``);
        });
        if (critical.length > 20) lines.push(`\n   _...y ${critical.length - 20} más_`);
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

  // 🟢 En Movimiento ───────────────────────────────────────────────────────
  const showMoving = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const moving = devices.filter((d) => d.status === "moving").sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));

      if (moving.length === 0) {
        await ctx.reply("ℹ️ No hay vehículos en movimiento actualmente.", MAIN_MENU);
        return;
      }

      const lines = [`🟢 *En Movimiento — ${moving.length} vehículos*\n_Ordenados por velocidad_\n`];
      moving.forEach((d, i) => {
        lines.push(`*${i + 1}. ${d.plate || d.name}*`);
        lines.push(`   🚀 Velocidad: ${d.speed ?? 0} km/h${(d.speed ?? 0) > 90 ? " ⚠️" : ""}`);
        if (d.driver) lines.push(`   👤 Conductor: ${d.driver}`);
        lines.push(`   🕐 ${d.lastConnection}`);
        if (d.lat && d.lng) lines.push(`   📍 [Mapa](https://maps.google.com/?q=${d.lat},${d.lng})`);
        lines.push("");
      });

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Moving error");
      await ctx.reply("⚠️ Error al obtener vehículos en movimiento.", MAIN_MENU);
    }
  };

  bot.hears("🟢 En Movimiento", showMoving);
  bot.command("movimiento", showMoving);

  // 🔴 Desconectados ───────────────────────────────────────────────────────
  const showDisc = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const disc = devices
        .filter((d) => isDisc(d.status))
        .map((d) => ({ ...d, days: daysSince(parseDate(d.lastConnection)) }))
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

      if (disc.length === 0) {
        await ctx.reply("✅ No hay vehículos desconectados.", MAIN_MENU);
        return;
      }

      const lines = [`🔴 *Desconectados — ${disc.length} vehículos*\n_Ordenados por días sin conexión_\n`];
      disc.forEach((d) => {
        const warn = (d.days ?? 0) >= CRITICAL_DAYS ? " 🚨" : "";
        lines.push(`${stEmoji(d.status)} *${d.plate || d.name}*${warn}`);
        lines.push(`   ⏱️ Sin conexión: *${durationStr(d.days)}*`);
        lines.push(`   IMEI: \`${d.imei}\``);
        lines.push(`   SIM: ${d.simNumber}`);
        lines.push(`   🕐 Última: ${d.lastConnection}`);
        lines.push("");
      });

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Disconnected error");
      await ctx.reply("⚠️ Error al obtener desconectados.", MAIN_MENU);
    }
  };

  bot.hears("🔴 Desconectados", showDisc);
  bot.command("apagados", showDisc);
  bot.command("desconectados", showDisc);

  // 🟡 ACK / Encendidos ────────────────────────────────────────────────────
  bot.hears("🟡 ACK / Encendidos", async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const ack = devices.filter((d) => d.status === "ack");
      if (ack.length === 0) { await ctx.reply("ℹ️ No hay vehículos en estado ACK.", MORE_MENU); return; }
      const lines = [`🟡 *ACK / Encendidos — ${ack.length} vehículos*\n`];
      ack.forEach((d) => {
        lines.push(`• *${d.plate || d.name}*`);
        lines.push(`  IMEI: \`${d.imei}\`  SIM: ${d.simNumber}`);
        lines.push(`  🕐 ${d.lastConnection}`);
        lines.push("");
      });
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MORE_MENU });
    } catch { await ctx.reply("⚠️ Error.", MORE_MENU); }
  });

  // 🟠 Motor Ralentí ───────────────────────────────────────────────────────
  bot.hears("🟠 Motor Ralentí", async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const idle = devices.filter((d) => d.status === "engine_idle");
      if (idle.length === 0) { await ctx.reply("ℹ️ No hay vehículos en ralentí.", MORE_MENU); return; }
      const lines = [`🟠 *Motor en Ralentí — ${idle.length} vehículos*\n`];
      idle.forEach((d) => {
        lines.push(`• *${d.plate || d.name}*`);
        lines.push(`  IMEI: \`${d.imei}\`  SIM: ${d.simNumber}`);
        if (d.lat && d.lng) lines.push(`  📍 [Ver ubicación](https://maps.google.com/?q=${d.lat},${d.lng})`);
        lines.push(`  🕐 ${d.lastConnection}`);
        lines.push("");
      });
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MORE_MENU });
    } catch { await ctx.reply("⚠️ Error.", MORE_MENU); }
  });

  // ⚙️ Más Opciones ───────────────────────────────────────────────────────
  bot.hears("⚙️ Más Opciones", async (ctx: Context) => {
    await ctx.reply("Opciones adicionales:", MORE_MENU);
  });

  bot.hears("🏠 Menú Principal", async (ctx: Context) => {
    await ctx.reply("Menú principal:", MAIN_MENU);
  });

  // 🔍 Buscar ──────────────────────────────────────────────────────────────
  bot.hears("🔍 Buscar", async (ctx: Context) => {
    await ctx.reply(
      `🔍 *Búsqueda de Vehículos*\n\n` +
      `Envía: /buscar TEXTO\n\n` +
      `Búsqueda por:\n` +
      `  • Placa (ej: /buscar ABC123)\n` +
      `  • Nombre (ej: /buscar TOYOTA)\n` +
      `  • IMEI parcial (ej: /buscar 86038)\n` +
      `  • Número SIM (ej: /buscar 0414)\n\n` +
      `Para detalle completo usa:\n` +
      `  /estado PLACA`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("buscar", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase();
    if (!q) { await ctx.reply("❌ Ejemplo: /buscar ABC123", MAIN_MENU); return; }

    try {
      const devices = await fetchDevices();
      const results = devices.filter((d) =>
        d.plate.toUpperCase().includes(q) ||
        d.name.toUpperCase().includes(q) ||
        d.imei.includes(q) ||
        d.simNumber.includes(q)
      );

      if (results.length === 0) {
        await ctx.reply(`❌ Sin resultados para *"${q}"*.\n\nVerifica la placa o IMEI.`, { parse_mode: "Markdown", ...MAIN_MENU });
        return;
      }

      const lines = [`🔍 *Resultados: "${q}"* — ${results.length} encontrado(s)\n`];
      results.slice(0, 10).forEach((d) => {
        const days = daysSince(parseDate(d.lastConnection));
        lines.push(`${stEmoji(d.status)} *${d.plate || d.name}*`);
        lines.push(`   Estado: ${stLabel(d.status)}${(d.speed ?? 0) > 0 ? ` · ${d.speed} km/h` : ""}`);
        lines.push(`   IMEI: \`${d.imei}\` · SIM: ${d.simNumber}`);
        if (d.driver) lines.push(`   👤 ${d.driver}`);
        lines.push(`   🕐 ${d.lastConnection}${days !== null ? ` (${durationStr(days)})` : ""}`);
        if (d.lat && d.lng) lines.push(`   📍 [Mapa](https://maps.google.com/?q=${d.lat},${d.lng})`);
        lines.push(`   ➡️ /estado ${d.plate || d.name.split(" ")[0]}`);
        lines.push("");
      });

      if (results.length > 10) lines.push(`_...y ${results.length - 10} más. Refina la búsqueda._`);

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Search error");
      await ctx.reply("⚠️ Error al buscar.", MAIN_MENU);
    }
  });

  // /estado PLACA — Detalle técnico completo ───────────────────────────────
  bot.command("estado", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase();
    if (!q) { await ctx.reply("Uso: /estado PLACA\nEjemplo: /estado ABC123"); return; }

    try {
      const devices = await fetchDevices();
      const d = devices.find((dev) =>
        dev.plate.toUpperCase().includes(q) || dev.name.toUpperCase().includes(q) || dev.id === q
      );

      if (!d) {
        await ctx.reply(`❌ No encontré *"${q}"* en la flota.\nUsa /buscar para una búsqueda amplia.`, { parse_mode: "Markdown" });
        return;
      }

      const days = daysSince(parseDate(d.lastConnection));
      const lines = [
        `${stEmoji(d.status)} *DETALLE TÉCNICO — ${d.plate || d.name}*\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📌 *Identificación:*`,
        `   Placa: *${d.plate || "N/A"}*`,
        `   Nombre: ${d.name}`,
        `   ID Sistema: \`${d.id}\``,
        ``,
        `📡 *Estado:*`,
        `   ${stEmoji(d.status)} *${stLabel(d.status)}*`,
        d.speed !== null ? `   Velocidad: *${d.speed} km/h*${(d.speed ?? 0) > 90 ? " ⚠️" : ""}` : "",
        d.driver ? `   👤 Conductor: ${d.driver}` : "",
        ``,
        `🔧 *Equipo:*`,
        `   IMEI: \`${d.imei}\``,
        `   SIM: ${d.simNumber}`,
        ``,
        `🕐 *Conectividad:*`,
        `   Última conexión: ${d.lastConnection}`,
        days !== null ? `   Tiempo sin conexión: *${durationStr(days)}*${days >= CRITICAL_DAYS ? " 🚨" : ""}` : "",
        `━━━━━━━━━━━━━━━━━━━━`,
      ].filter(Boolean);

      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });

      if (d.lat && d.lng) {
        await ctx.reply(`📍 Última posición conocida:`, { parse_mode: "Markdown" });
        await ctx.replyWithLocation(d.lat, d.lng);
      } else {
        await ctx.reply("📍 Posición GPS no disponible.", MAIN_MENU);
      }
    } catch (err) {
      logger.error({ err }, "Estado error");
      await ctx.reply("⚠️ Error al obtener datos del vehículo.", MAIN_MENU);
    }
  });

  // 📍 Ubicación por Placa ─────────────────────────────────────────────────
  bot.hears("📍 Ubicación por Placa", async (ctx: Context) => {
    await ctx.reply(
      "📍 Envía: /ubicacion PLACA\n\nEjemplo: /ubicacion ABC123",
      MORE_MENU
    );
  });

  bot.command("ubicacion", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase();
    if (!q) { await ctx.reply("Uso: /ubicacion PLACA"); return; }

    try {
      const devices = await fetchDevices();
      const d = devices.find((dev) =>
        dev.plate.toUpperCase().includes(q) || dev.name.toUpperCase().includes(q)
      );

      if (!d) { await ctx.reply(`❌ No encontré "${q}".`); return; }
      if (!d.lat || !d.lng) { await ctx.reply(`⚠️ *${d.plate || d.name}* no tiene posición GPS disponible.`, { parse_mode: "Markdown" }); return; }

      await ctx.reply(
        `📍 *${d.plate || d.name}* — ${stEmoji(d.status)} ${stLabel(d.status)}${d.speed ? ` · ${d.speed} km/h` : ""}`,
        { parse_mode: "Markdown" }
      );
      await ctx.replyWithLocation(d.lat, d.lng);
    } catch (err) {
      logger.error({ err }, "Ubicacion error");
      await ctx.reply("⚠️ Error al obtener ubicación.", MAIN_MENU);
    }
  });

  // 📋 Flota Completa ──────────────────────────────────────────────────────
  const showAll = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const groups: Record<string, GpsDevice[]> = {
        moving: [], ack: [], engine_idle: [], disconnected_red: [], disconnected_blue: [],
      };
      for (const d of devices) {
        const key = groups[d.status] ? d.status : "disconnected_blue";
        groups[key]!.push(d);
      }

      const lines = [
        `📋 *FLOTA COMPLETA — ${devices.length} vehículos*\n`,
        `🟢 En movimiento: *${groups["moving"]!.length}*`,
        `🟡 ACK/Encendidos: *${groups["ack"]!.length}*`,
        `🟠 Ralentí: *${groups["engine_idle"]!.length}*`,
        `🔴 Sin señal: *${groups["disconnected_red"]!.length}*`,
        `🔵 Desconectados: *${groups["disconnected_blue"]!.length}*\n`,
      ];

      for (const [status, list] of Object.entries(groups)) {
        if (list.length === 0) continue;
        lines.push(`${stEmoji(status)} *${stLabel(status)}* (${list.length}):`);
        list.slice(0, 20).forEach((d) => {
          const sp = status === "moving" && (d.speed ?? 0) > 0 ? ` — ${d.speed}km/h` : "";
          lines.push(`  • *${d.plate || d.name}*${sp}`);
        });
        if (list.length > 20) lines.push(`  _...y ${list.length - 20} más_`);
        lines.push("");
      }

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "FlotaCompleta error");
      await ctx.reply("⚠️ Error al obtener la flota.", MAIN_MENU);
    }
  };

  bot.hears("📋 Flota Completa", showAll);
  bot.command("todos", showAll);

  // 🗓️ Historial Reciente ─────────────────────────────────────────────────
  bot.hears("🗓️ Historial Reciente", async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const recent = devices
        .filter((d) => !isDisc(d.status) || (daysSince(parseDate(d.lastConnection)) ?? 99) < 1)
        .slice(0, 15);

      if (recent.length === 0) { await ctx.reply("ℹ️ Sin actividad reciente.", MORE_MENU); return; }

      const lines = [`🗓️ *Actividad Reciente*\n`];
      recent.forEach((d) => {
        lines.push(`${stEmoji(d.status)} *${d.plate || d.name}* — ${stLabel(d.status)}`);
        lines.push(`   🕐 ${d.lastConnection}`);
      });
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MORE_MENU });
    } catch { await ctx.reply("⚠️ Error.", MORE_MENU); }
  });

  // 📨 Reporte Técnico ─────────────────────────────────────────────────────
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
      const activeRatio = stats.total > 0
        ? Math.round(((stats.moving + stats.ack + stats.engineIdle) / stats.total) * 100)
        : 0;

      const lines = [
        `📊 *REPORTE TÉCNICO — GPS SISTEMA C.A.*`,
        `📅 ${new Date().toLocaleString("es-VE")}\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📈 *RESUMEN EJECUTIVO*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `Total flota: *${stats.total}* vehículos`,
        `Índice de actividad: *${activeRatio}%*\n`,
        `🟢 En movimiento:  *${stats.moving}*`,
        `🟡 ACK/Encendidos: *${stats.ack}*`,
        `🟠 Motor Ralentí:  *${stats.engineIdle}*`,
        `🔴 Desconectados:  *${stats.disconnected}*\n`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🚨 *ALERTAS ACTIVAS*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `⚡ Exceso de velocidad: *${speeders.length}*`,
        `🔴 +${CRITICAL_DAYS} días sin conexión: *${critical.length}*\n`,
      ];

      if (speeders.length > 0) {
        lines.push(`⚡ *Vehículos con exceso de velocidad:*`);
        speeders.forEach((d) => lines.push(`   • *${d.plate || d.name}* — ${d.speed} km/h`));
        lines.push("");
      }

      if (critical.length > 0) {
        lines.push(`🔴 *Vehículos críticos (+${CRITICAL_DAYS} días):*`);
        critical.slice(0, 25).forEach((d) => {
          const days = daysSince(parseDate(d.lastConnection));
          lines.push(`   • *${d.plate || d.name}* — ${durationStr(days)} · IMEI: ${d.imei}`);
        });
        if (critical.length > 25) lines.push(`   _...y ${critical.length - 25} más_`);
      }

      lines.push(`\n━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`_Reporte generado automáticamente_`);
      lines.push(`_GPS SISTEMA C.A. · rastreoplus247.com_`);

      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch (err) {
      logger.error({ err }, "Report error");
      await ctx.reply("⚠️ Error al generar reporte.", MAIN_MENU);
    }
  };

  bot.hears("📨 Reporte Técnico", sendReport);
  bot.command("reporte", sendReport);

  // ❓ Ayuda ────────────────────────────────────────────────────────────────
  bot.command("ayuda", async (ctx: Context) => {
    await ctx.reply(
      `🛰️ *GPS SISTEMA C.A. — Comandos Técnicos*\n\n` +
      `*Dashboard y Reportes:*\n` +
      `/dashboard — Resumen ejecutivo en tiempo real\n` +
      `/reporte — Reporte técnico completo\n` +
      `/alertas — Alertas activas (velocidad + críticos)\n\n` +
      `*Estado de Flota:*\n` +
      `/movimiento — Vehículos en movimiento\n` +
      `/apagados — Vehículos desconectados\n` +
      `/todos — Flota completa por grupo\n\n` +
      `*Vehículo específico:*\n` +
      `/buscar TEXTO — Buscar por placa/IMEI/nombre\n` +
      `/estado PLACA — Ficha técnica completa\n` +
      `/ubicacion PLACA — Ver posición en mapa\n\n` +
      `_Datos en vivo · rastreoplus247.com_`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  });

  // Launch ─────────────────────────────────────────────────────────────────
  bot.launch({ dropPendingUpdates: true })
    .then(() => logger.info("Support Telegram bot started"))
    .catch((err: unknown) => logger.error({ err }, "Failed to start support bot"));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
