import { startClientBot } from "./client-bot";
import { startSupportBot } from "./support-bot";
import { logger } from "../lib/logger";
import type { Telegraf } from "telegraf";

let _clientBot: Telegraf | null = null;
let _supportBot: Telegraf | null = null;

export function getClientBot(): Telegraf | null { return _clientBot; }
export function getSupportBot(): Telegraf | null { return _supportBot; }

export function startBots(): void {
  if (process.env["NODE_ENV"] !== "production") {
    logger.info(
      "Telegram bots disabled in development — only run in production to avoid competing for updates with the same token.",
    );
    return;
  }

  logger.info("Starting Telegram bots...");
  try {
    _clientBot = startClientBot();
  } catch (err) {
    logger.error({ err }, "Error starting client bot");
  }
  try {
    _supportBot = startSupportBot();
  } catch (err) {
    logger.error({ err }, "Error starting support bot");
  }
}
