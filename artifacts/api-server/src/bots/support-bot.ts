import { Telegraf, Markup, type Context } from "telegraf";
import { fetchDevices, fetchFleetStats, type GpsDevice } from "../lib/gps-service";
import { logger } from "../lib/logger";

const TOKEN = process.env["TELEGRAM_SUPPORT_BOT_TOKEN"] ?? "";

const DISCONNECTED_THRESHOLD_DAYS = 7;

const MAIN_MENU = Markup.keyboard([
  ["📊 Estadísticas", "🟢 En Movimiento"],
  ["🔴 Apagados", "⚠️ +7 Días Desconectados"],
  ["🔍 Buscar Vehículo", "📋 Todos los Vehículos"],
  ["📨 Reporte", "❓ Ayuda"],
]).resize();

function emoji(status: string): string {
  switch (status) {
    case "moving": return "🟢";
    case "ack": return "🟡";
    case "engine_idle": return "🟠";
    case "disconnected_red": return "🔴";
    case "disconnected_blue": return "🔵";
    default: return "⚪";
  }
}

function label(status: string): string {
  switch (status) {
    case "moving": return "En Movimiento";
    case "ack": return "ACK";
    case "engine_idle": return "Motor Ralentí";
    case "disconnected_red": return "Desconectado (Sin Señal)";
    case "disconnected_blue": return "Desconectado";
    default: return "Desconocido";
  }
}

function parseDate(s: string): Date | null {
  if (!s || s === "N/A" || s === "Invalid Date") return null;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const m = s.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)/i);
    if (m) {
      let h = parseInt(m[4]!);
      if (m[7]!.toUpperCase() === "PM" && h < 12) h += 12;
      if (m[7]!.toUpperCase() === "AM" && h === 12) h = 0;
      return new Date(parseInt(m[3]!), parseInt(m[2]!) - 1, parseInt(m[1]!), h, parseInt(m[5]!), parseInt(m[6]!));
    }
    return null;
  } catch { return null; }
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

async function sendLong(ctx: Context, text: string, extra?: object): Promise<void> {
  const MAX = 4000;
  if (text.length <= MAX) { await ctx.reply(text, extra); return; }
  const lines = text.split("\n");
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if ((cur + "\n" + line).length > MAX) {
      if (cur) chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i]!, i === chunks.length - 1 ? extra : { parse_mode: "Markdown" });
  }
}

function getText(ctx: Context): string {
  return (ctx.message as { text?: string } | undefined)?.text ?? "";
}

export function startSupportBot(): void {
  if (!TOKEN) {
    logger.warn("TELEGRAM_SUPPORT_BOT_TOKEN not set, support bot disabled");
    return;
  }

  const bot = new Telegraf(TOKEN);

  // /start
  bot.start(async (ctx: Context) => {
    await ctx.reply(
      `🛠️ *GPS SISTEMA C.A. — Bot de Soporte Técnico*\n\n` +
      `Bienvenido, *${ctx.from?.first_name ?? "Técnico"}*.\n\n` +
      `Tienes acceso completo a todos los datos técnicos de la flota.\n` +
      `Selecciona una opción:`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  });

  // 📊 Estadísticas
  const showStats = async (ctx: Context) => {
    try {
      const [stats, devices] = await Promise.all([fetchFleetStats(), fetchDevices()]);
      const critical = devices.filter((d) => {
        if (d.status !== "disconnected_blue" && d.status !== "disconnected_red") return false;
        const days = daysSince(parseDate(d.lastConnection));
        return days !== null && days >= DISCONNECTED_THRESHOLD_DAYS;
      });

      await ctx.reply(
        `📊 *Estadísticas de la Flota*\n_${new Date().toLocaleString("es-VE")}_\n\n` +
        `🚗 Total: *${stats.total}*\n` +
        `🟢 En movimiento: *${stats.moving}*\n` +
        `🟠 Motor ralentí: *${stats.engineIdle}*\n` +
        `🟡 ACK: *${stats.ack}*\n` +
        `🔴 Desconectados: *${stats.disconnected}*\n\n` +
        `⚠️ +7 días desconectados: *${critical.length}*\n` +
        `💡 Activo: *${Math.round(((stats.moving + stats.ack + stats.engineIdle) / stats.total) * 100)}%*`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
    } catch { await ctx.reply("⚠️ Error al obtener estadísticas."); }
  };

  bot.hears("📊 Estadísticas", showStats);
  bot.command("estadisticas", showStats);

  // 🟢 En Movimiento
  const showMoving = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const moving = devices.filter((d) => d.status === "moving");

      if (moving.length === 0) { await ctx.reply("ℹ️ No hay vehículos en movimiento.", MAIN_MENU); return; }

      const lines = [`🟢 *En Movimiento* (${moving.length} vehículos)\n`];
      for (const d of moving) {
        lines.push(`• *${d.plate || d.name}*`);
        if (d.speed && d.speed > 0) lines.push(`  Vel: ${d.speed} km/h`);
        lines.push(`  IMEI: ${d.imei} | SIM: ${d.simNumber}`);
        lines.push(`  Última: ${d.lastConnection}`);
        lines.push("");
      }
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch { await ctx.reply("⚠️ Error al obtener vehículos en movimiento."); }
  };

  bot.hears("🟢 En Movimiento", showMoving);
  bot.command("movimiento", showMoving);

  // 🔴 Apagados
  const showOff = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const off = devices.filter((d) => d.status === "disconnected_blue" || d.status === "disconnected_red");

      if (off.length === 0) { await ctx.reply("✅ No hay vehículos desconectados.", MAIN_MENU); return; }

      const lines = [`🔴 *Desconectados* (${off.length} vehículos)\n`];
      for (const d of off) {
        const days = daysSince(parseDate(d.lastConnection));
        lines.push(`${emoji(d.status)} *${d.plate || d.name}*`);
        lines.push(`  Días sin conexión: *${days ?? "?"}*`);
        lines.push(`  IMEI: ${d.imei} | SIM: ${d.simNumber}`);
        lines.push(`  Última: ${d.lastConnection}`);
        lines.push("");
      }
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch { await ctx.reply("⚠️ Error al obtener vehículos desconectados."); }
  };

  bot.hears("🔴 Apagados", showOff);
  bot.command("apagados", showOff);

  // ⚠️ +7 Días Desconectados
  const showCritical = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const critical = devices
        .filter((d) => {
          if (d.status !== "disconnected_blue" && d.status !== "disconnected_red") return false;
          const days = daysSince(parseDate(d.lastConnection));
          return days !== null && days >= DISCONNECTED_THRESHOLD_DAYS;
        })
        .sort((a, b) => (daysSince(parseDate(b.lastConnection)) ?? 0) - (daysSince(parseDate(a.lastConnection)) ?? 0));

      if (critical.length === 0) { await ctx.reply("✅ No hay vehículos con +7 días desconectados.", MAIN_MENU); return; }

      const lines = [`⚠️ *Desconectados +7 Días* (${critical.length} vehículos)\n_Requieren atención técnica_\n`];
      for (const d of critical) {
        const days = daysSince(parseDate(d.lastConnection));
        lines.push(`• *${d.plate || d.name}* — *${days}* días sin conexión`);
        lines.push(`  Última: ${d.lastConnection}`);
        lines.push(`  IMEI: ${d.imei} | SIM: ${d.simNumber}`);
        lines.push(`  Estado: ${emoji(d.status)} ${label(d.status)}`);
        lines.push("");
      }
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch { await ctx.reply("⚠️ Error al obtener lista crítica."); }
  };

  bot.hears("⚠️ +7 Días Desconectados", showCritical);
  bot.command("criticos", showCritical);

  // 🔍 Buscar Vehículo
  bot.hears("🔍 Buscar Vehículo", async (ctx: Context) => {
    await ctx.reply(
      "🔍 Usa el comando /buscar TEXTO\n\nEjemplos:\n" +
      "/buscar ABC123 — por placa\n" +
      "/buscar TOYOTA — por nombre\n" +
      "/buscar 603808 — por IMEI parcial"
    );
  });

  bot.command("buscar", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase();
    if (!q) { await ctx.reply("❌ Proporciona un término.\nEjemplo: /buscar ABC123"); return; }

    try {
      const devices = await fetchDevices();
      const results = devices.filter((d) =>
        d.plate.toUpperCase().includes(q) ||
        d.name.toUpperCase().includes(q) ||
        d.imei.includes(q) ||
        d.simNumber.includes(q)
      );

      if (results.length === 0) { await ctx.reply(`❌ Sin resultados para "${q}".`); return; }

      const lines = [`🔍 *Resultados "${q}"* (${results.length})\n`];
      for (const d of results) {
        const days = daysSince(parseDate(d.lastConnection));
        lines.push(`${emoji(d.status)} *${d.plate || d.name}*`);
        lines.push(`  Nombre: ${d.name}`);
        lines.push(`  Estado: ${label(d.status)}`);
        if (d.speed && d.speed > 0) lines.push(`  Vel: ${d.speed} km/h`);
        lines.push(`  IMEI: \`${d.imei}\` | SIM: ${d.simNumber}`);
        lines.push(`  Última: ${d.lastConnection}`);
        if (days !== null) lines.push(`  Días: ${days}`);
        if (d.lat && d.lng) lines.push(`  GPS: ${d.lat}, ${d.lng}`);
        lines.push("");
      }
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown" });
    } catch { await ctx.reply("⚠️ Error al buscar."); }
  });

  // /estado
  bot.command("estado", async (ctx: Context) => {
    const q = getText(ctx).split(" ").slice(1).join(" ").trim().toUpperCase();
    if (!q) { await ctx.reply("Uso: /estado PLACA"); return; }

    try {
      const devices = await fetchDevices();
      const d = devices.find((dev) => dev.plate.toUpperCase().includes(q) || dev.name.toUpperCase().includes(q));
      if (!d) { await ctx.reply(`❌ No encontré "${q}".`); return; }

      const days = daysSince(parseDate(d.lastConnection));
      let msg = `${emoji(d.status)} *${d.plate || d.name} — Detalle Técnico*\n\n`;
      msg += `Nombre: ${d.name}\nPlaca: ${d.plate || "N/A"}\nID: ${d.id}\n`;
      msg += `Estado: *${label(d.status)}*\n`;
      if (d.speed !== null) msg += `Vel: ${d.speed} km/h\n`;
      msg += `\nIMEI: \`${d.imei}\`\nSIM: ${d.simNumber}\n`;
      msg += `Última conexión: ${d.lastConnection}\n`;
      if (days !== null) msg += `Días sin conexión: *${days}*\n`;
      if (d.lat && d.lng) msg += `\nGPS: ${d.lat}, ${d.lng}\n`;
      if (d.address) msg += `Dirección: ${d.address}\n`;
      if (d.driver) msg += `Conductor: ${d.driver}`;

      await ctx.reply(msg, { parse_mode: "Markdown" });
      if (d.lat && d.lng) await ctx.replyWithLocation(d.lat, d.lng);
    } catch { await ctx.reply("⚠️ Error al obtener estado."); }
  });

  // 📋 Todos los Vehículos
  const showAll = async (ctx: Context) => {
    try {
      const devices = await fetchDevices();
      const groups: Record<string, GpsDevice[]> = {
        moving: [],
        engine_idle: [],
        ack: [],
        disconnected_red: [],
        disconnected_blue: [],
      };
      for (const d of devices) {
        (groups[d.status] ?? groups["disconnected_blue"]!).push(d);
      }

      const lines = [`📋 *Todos los Vehículos* (${devices.length} total)\n`];
      for (const [status, list] of Object.entries(groups)) {
        if (list.length === 0) continue;
        lines.push(`${emoji(status)} *${label(status)}* (${list.length}):`);
        list.slice(0, 15).forEach((d) => lines.push(`  • ${d.plate || d.name}`));
        if (list.length > 15) lines.push(`  _...y ${list.length - 15} más_`);
        lines.push("");
      }
      await sendLong(ctx, lines.join("\n"), { parse_mode: "Markdown", ...MAIN_MENU });
    } catch { await ctx.reply("⚠️ Error al obtener la lista."); }
  };

  bot.hears("📋 Todos los Vehículos", showAll);
  bot.command("todos", showAll);

  // 📨 Reporte
  const sendReport = async (ctx: Context) => {
    try {
      await ctx.reply("⏳ Generando reporte...");
      const [devices, stats] = await Promise.all([fetchDevices(), fetchFleetStats()]);

      const critical = devices.filter((d) => {
        if (d.status !== "disconnected_blue" && d.status !== "disconnected_red") return false;
        const days = daysSince(parseDate(d.lastConnection));
        return days !== null && days >= DISCONNECTED_THRESHOLD_DAYS;
      });

      const now = new Date().toLocaleString("es-VE");
      let report = `📊 *REPORTE TÉCNICO — GPS SISTEMA C.A.*\n📅 ${now}\n\n`;
      report += `📈 *RESUMEN:*\n`;
      report += `Total: *${stats.total}* | 🟢 *${stats.moving}* | 🟠 *${stats.engineIdle}* | 🟡 *${stats.ack}* | 🔴 *${stats.disconnected}*\n\n`;
      report += `⚠️ *CRÍTICOS (+7 días): ${critical.length}*\n\n`;

      if (critical.length > 0) {
        for (const d of critical.slice(0, 20)) {
          const days = daysSince(parseDate(d.lastConnection));
          report += `• ${d.plate || d.name} — *${days}* días (${d.imei})\n`;
        }
        if (critical.length > 20) report += `_...y ${critical.length - 20} más_\n`;
      }

      report += `\n_Generado por Bot de Soporte GPS SISTEMA C.A._`;
      await ctx.reply(report, { parse_mode: "Markdown", ...MAIN_MENU });
    } catch { await ctx.reply("⚠️ Error al generar reporte."); }
  };

  bot.hears("📨 Reporte", sendReport);
  bot.command("reporte", sendReport);

  // ❓ Ayuda
  const showHelp = async (ctx: Context) => {
    await ctx.reply(
      `🛠️ *Bot de Soporte Técnico — Comandos*\n\n` +
      `/estadisticas — Resumen de la flota\n` +
      `/movimiento — Vehículos en movimiento\n` +
      `/apagados — Vehículos desconectados\n` +
      `/criticos — Desconectados +7 días\n` +
      `/todos — Lista completa por estado\n` +
      `/buscar TEXTO — Buscar vehículo\n` +
      `/estado PLACA — Detalle técnico\n` +
      `/reporte — Reporte completo\n\n` +
      `_Datos en tiempo real de rastreoplus247.com_`,
      { parse_mode: "Markdown" }
    );
  };

  bot.hears("❓ Ayuda", showHelp);
  bot.command("ayuda", showHelp);

  bot.launch({ dropPendingUpdates: true })
    .then(() => logger.info("Support Telegram bot started"))
    .catch((err: unknown) => logger.error({ err }, "Failed to start support bot"));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
