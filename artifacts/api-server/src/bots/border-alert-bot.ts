/**
 * Bot de Alertas de Frontera — GPS SISTEMA C.A.
 *
 * Cualquier usuario que escriba /start queda suscrito a alertas automáticas
 * de vehículos Teltonika que se acercan a la frontera Colombia-Venezuela.
 *
 * Token: TELEGRAM_BOT_TOKEN
 */
import { Telegraf, type Context } from "telegraf";
import { db, telegramBorderSubscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";

let _bot: Telegraf | null = null;

// ─── Broadcast ────────────────────────────────────────────────────────────────

/**
 * Sends `text` (Markdown) to all subscribers.
 * If lat/lng are provided, also sends a location pin.
 */
export async function sendBorderAlert(text: string, lat?: number, lng?: number): Promise<void> {
  if (!_bot) return;
  let subscribers: { chatId: string }[] = [];
  try {
    subscribers = await db
      .select({ chatId: telegramBorderSubscribersTable.chatId })
      .from(telegramBorderSubscribersTable);
  } catch (err) {
    logger.error({ err }, "Border alert: failed to load subscribers");
    return;
  }

  for (const { chatId } of subscribers) {
    try {
      await _bot.telegram.sendMessage(chatId, text, { parse_mode: "Markdown" });
      if (lat !== undefined && lng !== undefined) {
        await _bot.telegram.sendLocation(chatId, lat, lng);
      }
    } catch (err) {
      logger.warn({ err, chatId }, "Border alert: send failed");
    }
  }
}

// ─── Bot setup ────────────────────────────────────────────────────────────────

async function handleStart(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  const username = ctx.from?.username ?? null;
  const firstName = ctx.from?.first_name ?? null;
  if (!chatId) return;

  try {
    await db
      .insert(telegramBorderSubscribersTable)
      .values({ chatId, username, firstName })
      .onConflictDoUpdate({
        target: telegramBorderSubscribersTable.chatId,
        set: { username, firstName },
      });
    await ctx.reply(
      `✅ *Suscrito a alertas de frontera*\n\n` +
      `Recibirás notificaciones cuando un vehículo *Teltonika* se encuentre a menos de *30 km* de la frontera Colombia-Venezuela.\n\n` +
      `Usa /stop para cancelar la suscripción.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    logger.error({ err, chatId }, "Border bot: /start DB error");
    await ctx.reply("⚠️ Error al suscribirte. Intenta de nuevo.");
  }
}

async function handleStop(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) return;
  try {
    await db
      .delete(telegramBorderSubscribersTable)
      .where(eq(telegramBorderSubscribersTable.chatId, chatId));
    await ctx.reply("🔕 Suscripción cancelada. Ya no recibirás alertas de frontera.");
  } catch (err) {
    logger.error({ err, chatId }, "Border bot: /stop DB error");
    await ctx.reply("⚠️ Error al cancelar. Intenta de nuevo.");
  }
}

async function handleStatus(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) return;
  try {
    const rows = await db
      .select()
      .from(telegramBorderSubscribersTable)
      .where(eq(telegramBorderSubscribersTable.chatId, chatId));
    if (rows.length > 0) {
      const sub = rows[0]!;
      await ctx.reply(
        `✅ *Estás suscrito* a alertas de frontera.\n` +
        `📅 Desde: ${sub.subscribedAt.toLocaleString("es-VE", { timeZone: "America/Caracas" })}\n\n` +
        `Usa /stop para cancelar.`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply("❌ No estás suscrito. Usa /start para suscribirte.");
    }
  } catch (err) {
    logger.error({ err }, "Border bot: /estado DB error");
    await ctx.reply("⚠️ Error al consultar. Intenta de nuevo.");
  }
}

// ─── Resilient launcher (polling fallback) ───────────────────────────────────

async function launchWithRetry(bot: Telegraf, name: string, attempt = 1): Promise<void> {
  try {
    await bot.launch();
    logger.info({ name }, "Bot launched (long polling)");
  } catch (err) {
    const delay = Math.min(attempt * 5_000, 60_000);
    logger.warn({ err, name, attempt, delay }, "Bot launch failed — retrying");
    setTimeout(() => { void launchWithRetry(bot, name, attempt + 1); }, delay);
  }
}

// ─── Launcher ─────────────────────────────────────────────────────────────────

export function startBorderAlertBot(): Telegraf {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const bot = new Telegraf(TOKEN);
  _bot = bot;

  bot.start(handleStart);
  bot.command("stop", handleStop);
  bot.command("estado", handleStatus);

  // Re-subscribe if the user sends any text (convenience)
  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();
    if (text === "suscribir" || text === "activar") {
      await handleStart(ctx);
    } else if (text === "cancelar" || text === "desactivar") {
      await handleStop(ctx);
    } else {
      await ctx.reply(
        `🛰️ *Bot de Alertas de Frontera — GPS SISTEMA C.A.*\n\n` +
        `Comandos disponibles:\n` +
        `• /start — suscribirte a alertas\n` +
        `• /stop — cancelar suscripción\n` +
        `• /estado — ver tu suscripción`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // Production: register webhook via REPLIT_DOMAINS. Dev: long polling.
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  if (domain) {
    const webhookUrl = `https://${domain}/api/bot/border`;
    void bot.telegram.setWebhook(webhookUrl)
      .then(() => logger.info({ webhookUrl }, "Border alert bot webhook set"))
      .catch((err: unknown) => logger.error({ err }, "Failed to set border alert bot webhook"));
  } else {
    void launchWithRetry(bot, "border-alert");
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return bot;
}

export function getBorderAlertBot(): Telegraf | null {
  return _bot;
}
