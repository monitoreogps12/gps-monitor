import { Router, type IRouter } from "express";
import { getClientBot, getSupportBot } from "../bots";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Telegram webhook — client bot
router.post("/bot/client", async (req, res) => {
  res.sendStatus(200);
  try {
    const bot = getClientBot();
    if (bot) await bot.handleUpdate(req.body);
  } catch (err) {
    logger.warn({ err }, "Error handling client bot update");
  }
});

// Telegram webhook — support bot
router.post("/bot/support", async (req, res) => {
  res.sendStatus(200);
  try {
    const bot = getSupportBot();
    if (bot) await bot.handleUpdate(req.body);
  } catch (err) {
    logger.warn({ err }, "Error handling support bot update");
  }
});

export default router;
