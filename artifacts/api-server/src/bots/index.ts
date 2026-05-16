import { startClientBot } from "./client-bot";
import { startSupportBot } from "./support-bot";
import { logger } from "../lib/logger";

export function startBots(): void {
  logger.info("Starting Telegram bots...");
  try {
    startClientBot();
  } catch (err) {
    logger.error({ err }, "Error starting client bot");
  }
  try {
    startSupportBot();
  } catch (err) {
    logger.error({ err }, "Error starting support bot");
  }
}
