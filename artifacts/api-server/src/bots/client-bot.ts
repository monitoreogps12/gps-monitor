import { Telegraf, Markup, type Context } from "telegraf";
import { db } from "@workspace/db";
import { clientsTable, clientVehiclesTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { fetchDevices } from "../lib/gps-service";
import { logger } from "../lib/logger";
import { startNotificationService } from "./notifications";

const TOKEN = process.env["TELEGRAM_CLIENT_BOT_TOKEN"] ?? "";

const MAIN_MENU = Markup.keyboard([
  ["🚗 Mis Vehículos", "📊 Estado General"],
  ["📍 Ubicación de Vehículo", "❓ Ayuda"],
]).resize();

function statusLabel(status: string): string {
  switch (status) {
    case "moving": return "🟢 En Movimiento";
    case "ack": return "🟡 ACK (Encendido)";
    case "engine_idle": return "🟠 Motor en Ralentí";
    case "disconnected_red": return "🔴 Desconectado (Sin Señal)";
    case "disconnected_blue": return "🔵 Desconectado";
    default: return "⚪ Desconocido";
  }
}

async function getClient(chatId: string) {
  const rows = await db.select().from(clientsTable).where(eq(clientsTable.telegramId, chatId));
  return rows[0] ?? null;
}

export function startClientBot(): void {
  if (!TOKEN) {
    logger.warn("TELEGRAM_CLIENT_BOT_TOKEN not set, client bot disabled");
    return;
  }

  const bot = new Telegraf(TOKEN);

  // /start
  bot.start(async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const firstName = ctx.from?.first_name ?? "Cliente";
    const client = await getClient(chatId);

    if (client) {
      await ctx.reply(
        `✅ Bienvenido de nuevo, *${client.name}*!\n\n` +
        `📡 Recibirás notificaciones automáticas cuando:\n` +
        `• Tu vehículo se encienda o apague\n` +
        `• Exceda los 90 km/h\n` +
        `• Cambie de estado\n\n` +
        `Usa el menú para monitorear tu flota.`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    await ctx.reply(
      `👋 Bienvenido a *GPS SISTEMA C.A.*, ${firstName}!\n\n` +
      `Para comenzar regístrate con tu número de teléfono:\n\n` +
      `/registrar +584XXXXXXXXX\n\n_Ejemplo: /registrar +584147583683_`,
      { parse_mode: "Markdown" }
    );
  });

  // /registrar
  bot.command("registrar", async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const msg = (ctx.message as { text: string }).text;
    const phone = msg.split(" ").slice(1).join("").trim();

    if (!phone) {
      await ctx.reply("❌ Proporciona tu número.\nEjemplo: /registrar +584147583683");
      return;
    }

    const existing = await getClient(chatId);
    if (existing) {
      await ctx.reply(`✅ Ya estás registrado como *${existing.name}*.`, { parse_mode: "Markdown" });
      return;
    }

    const byPhone = await db.select().from(clientsTable).where(eq(clientsTable.phone, phone));
    if (byPhone[0]) {
      await db.update(clientsTable)
        .set({ telegramId: chatId, telegramUsername: ctx.from?.username ?? null, updatedAt: new Date() })
        .where(eq(clientsTable.id, byPhone[0].id));
      await ctx.reply(
        `✅ ¡Cuenta vinculada!\n\nBienvenido, *${byPhone[0].name}*.\n\n` +
        `📡 Activando notificaciones automáticas:\n` +
        `• Encendido / Apagado\n• Exceso de velocidad (>90 km/h)\n• Cambios de estado`,
        { parse_mode: "Markdown", ...MAIN_MENU }
      );
      return;
    }

    const name = `${ctx.from?.first_name ?? ""} ${ctx.from?.last_name ?? ""}`.trim() || "Cliente";
    await db.insert(clientsTable).values({ name, phone, telegramId: chatId, telegramUsername: ctx.from?.username ?? null });
    await ctx.reply(
      `✅ ¡Registro exitoso!\n\nNúmero *${phone}* registrado.\n\nUn técnico de GPS SISTEMA C.A. asignará tus vehículos pronto y empezarás a recibir notificaciones.`,
      { parse_mode: "Markdown", ...MAIN_MENU }
    );
  });

  // 🚗 Mis Vehículos
  const showVehicles = async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const client = await getClient(chatId);
    if (!client) { await ctx.reply("❌ No estás registrado. Usa /start."); return; }

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) {
      await ctx.reply("ℹ️ No tienes vehículos asignados todavía.\n\nContacta a GPS SISTEMA C.A."); return;
    }

    let devices: Awaited<ReturnType<typeof fetchDevices>> = [];
    try { devices = await fetchDevices(); } catch { /* ignore */ }

    const lines: string[] = [`🚗 *Tus Vehículos* (${vehicles.length} en total)\n`];
    for (const v of vehicles) {
      const live = devices.find((d) => d.id === v.deviceId);
      const st = live ? statusLabel(live.status) : "⚪ Sin datos";
      const plate = v.plate || live?.plate || v.deviceId;
      lines.push(`*${plate}*`);
      lines.push(`Estado: ${st}`);
      if (live?.speed && live.speed > 0) lines.push(`Velocidad: *${live.speed} km/h*`);
      lines.push(`Última: ${live?.lastConnection || "N/A"}`);
      lines.push("");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  };

  bot.hears("🚗 Mis Vehículos", showVehicles);
  bot.command("mis_vehiculos", showVehicles);

  // 📊 Estado General
  const showEstado = async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const client = await getClient(chatId);
    if (!client) { await ctx.reply("❌ No estás registrado."); return; }

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) { await ctx.reply("ℹ️ No tienes vehículos asignados."); return; }

    let devices: Awaited<ReturnType<typeof fetchDevices>> = [];
    try { devices = await fetchDevices(); } catch { /* ignore */ }

    let moving = 0, connected = 0, disconnected = 0;
    for (const v of vehicles) {
      const live = devices.find((d) => d.id === v.deviceId);
      if (!live) { disconnected++; continue; }
      if (live.status === "moving") moving++;
      else if (live.status === "disconnected_blue" || live.status === "disconnected_red") disconnected++;
      else connected++;
    }

    await ctx.reply(
      `📊 *Resumen de tu Flota*\n\n` +
      `Total vehículos: *${vehicles.length}*\n` +
      `🟢 En movimiento: *${moving}*\n` +
      `🟡 Conectados/Encendidos: *${connected}*\n` +
      `🔴 Desconectados: *${disconnected}*\n\n` +
      `📡 Notificaciones automáticas: *Activas*\n` +
      `Límite de velocidad configurado: *90 km/h*`,
      { parse_mode: "Markdown" }
    );
  };

  bot.hears("📊 Estado General", showEstado);
  bot.command("estado_general", showEstado);

  // 📍 Ubicación de Vehículo — teclado con placas
  bot.hears("📍 Ubicación de Vehículo", async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const client = await getClient(chatId);
    if (!client) { await ctx.reply("❌ No estás registrado."); return; }

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    if (vehicles.length === 0) { await ctx.reply("ℹ️ No tienes vehículos asignados."); return; }

    const buttons = vehicles.map((v) => [`📍 ${v.plate || v.deviceName || v.deviceId}`]);
    await ctx.reply("Selecciona el vehículo:", Markup.keyboard([...buttons, ["🔙 Volver"]]).resize());
  });

  // Handle plate selection from keyboard
  bot.hears(/^📍 (.+)$/, async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const match = (ctx.message as { text: string }).text.match(/^📍 (.+)$/);
    const searchTerm = match?.[1]?.trim() ?? "";
    if (!searchTerm) return;

    const client = await getClient(chatId);
    if (!client) return;

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));
    const vehicle = vehicles.find((v) =>
      v.plate.toUpperCase().includes(searchTerm.toUpperCase()) ||
      v.deviceName.toUpperCase().includes(searchTerm.toUpperCase()) ||
      v.deviceId === searchTerm
    );

    if (!vehicle) { await ctx.reply("❌ Vehículo no encontrado.", MAIN_MENU); return; }

    try {
      const devices = await fetchDevices();
      const device = devices.find((d) => d.id === vehicle.deviceId);
      if (!device) { await ctx.reply("⚠️ Sin datos recientes para este vehículo.", MAIN_MENU); return; }

      const st = statusLabel(device.status);
      let msg = `📍 *${vehicle.plate || vehicle.deviceName}*\n\nEstado: ${st}\n`;
      if (device.speed && device.speed > 0) msg += `Velocidad: *${device.speed} km/h*\n`;
      msg += `Última conexión: ${device.lastConnection}\n`;

      if (device.lat && device.lng) {
        await ctx.reply(msg + "\n🗺️ Ubicación:", { parse_mode: "Markdown", ...MAIN_MENU });
        await ctx.replyWithLocation(device.lat, device.lng);
      } else {
        await ctx.reply(msg + "\n⚠️ Posición GPS no disponible.", { parse_mode: "Markdown", ...MAIN_MENU });
      }
    } catch {
      await ctx.reply("⚠️ Error al obtener datos.", MAIN_MENU);
    }
  });

  // /ubicacion [placa]
  bot.command("ubicacion", async (ctx: Context) => {
    const chatId = String(ctx.chat!.id);
    const msg = (ctx.message as { text: string }).text;
    const searchTerm = msg.split(" ").slice(1).join(" ").trim().toUpperCase();
    const client = await getClient(chatId);
    if (!client) { await ctx.reply("❌ No estás registrado."); return; }

    const vehicles = await db.select().from(clientVehiclesTable).where(eq(clientVehiclesTable.clientId, client.id));

    if (!searchTerm) {
      const list = vehicles.map((v) => `• ${v.plate || v.deviceName || v.deviceId}`).join("\n");
      await ctx.reply(`Usa: /ubicacion PLACA\n\nTus vehículos:\n${list}`);
      return;
    }

    const vehicle = vehicles.find((v) =>
      v.plate.toUpperCase().includes(searchTerm) || v.deviceName.toUpperCase().includes(searchTerm)
    );

    if (!vehicle) { await ctx.reply(`❌ No encontré el vehículo "${searchTerm}".`); return; }

    try {
      const devices = await fetchDevices();
      const device = devices.find((d) => d.id === vehicle.deviceId);
      if (!device) { await ctx.reply("⚠️ Sin datos recientes."); return; }

      const st = statusLabel(device.status);
      let msg2 = `📍 *${vehicle.plate || vehicle.deviceName}*\n\nEstado: ${st}\n`;
      if (device.speed && device.speed > 0) msg2 += `Velocidad: *${device.speed} km/h*\n`;
      msg2 += `Última conexión: ${device.lastConnection}\n`;

      if (device.lat && device.lng) {
        await ctx.reply(msg2 + "\n🗺️ Ubicación:", { parse_mode: "Markdown" });
        await ctx.replyWithLocation(device.lat, device.lng);
      } else {
        await ctx.reply(msg2 + "\n⚠️ Posición GPS no disponible.", { parse_mode: "Markdown" });
      }
    } catch {
      await ctx.reply("⚠️ Error al obtener datos.");
    }
  });

  // 🔙 Volver
  bot.hears("🔙 Volver", async (ctx: Context) => ctx.reply("Menú principal:", MAIN_MENU));

  // ❓ Ayuda
  const showHelp = async (ctx: Context) => {
    await ctx.reply(
      `*GPS SISTEMA C.A. — Ayuda*\n\n` +
      `📡 *Notificaciones automáticas activas:*\n` +
      `• 🔑 Vehículo encendido\n` +
      `• 🔴 Vehículo apagado/desconectado\n` +
      `• ⚠️ Exceso de velocidad (>90 km/h)\n` +
      `• 🔄 Cambios de estado\n\n` +
      `*Comandos manuales:*\n` +
      `🚗 /mis_vehiculos — Lista y estado\n` +
      `📍 /ubicacion PLACA — Ver ubicación\n` +
      `📊 /estado_general — Resumen de flota\n\n` +
      `📞 Soporte: GPS SISTEMA C.A.`,
      { parse_mode: "Markdown" }
    );
  };

  bot.hears("❓ Ayuda", showHelp);
  bot.command("ayuda", showHelp);

  // Start notification service
  startNotificationService(bot);

  bot.launch({ dropPendingUpdates: true })
    .then(() => logger.info("Client Telegram bot started with notifications"))
    .catch((err: unknown) => logger.error({ err }, "Failed to start client bot"));

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
