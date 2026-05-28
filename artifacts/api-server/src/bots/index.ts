import { startClientBot } from "./client-bot";
import { startSupportBot } from "./support-bot";
import { logger } from "../lib/logger";

export function startBots(): void {
  if (process.env["NODE_ENV"] !== "production") {
    logger.info(
      "Telegram bots disabled in development — only run in production to avoid competing for updates with the same token.",
    );
    return;
  }

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
