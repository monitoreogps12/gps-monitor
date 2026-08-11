import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Subscribers who have sent /start to the GPS border-alert bot.
 * When the bot broadcasts a Colombia-border proximity alert, it sends to all rows.
 */
export const telegramBorderSubscribersTable = pgTable("telegram_border_subscribers", {
  chatId:       text("chat_id").primaryKey(),
  username:     text("username"),
  firstName:    text("first_name"),
  subscribedAt: timestamp("subscribed_at").notNull().defaultNow(),
});

export type TelegramBorderSubscriber = typeof telegramBorderSubscribersTable.$inferSelect;
