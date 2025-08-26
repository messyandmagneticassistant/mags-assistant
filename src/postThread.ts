import { BotSession } from './types';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const LOG_TO_CONSOLE = process.env.MAGGIE_LOG_TO_CONSOLE !== 'false'; // true by default

export async function postThread({
  bot,
  message,
}: {
  bot: BotSession;
  message: string;
}): Promise<void> {
  const fullMessage = `🤖 [${bot.name}] ${message}`;

  if (LOG_TO_CONSOLE) {
    console.log(`[postThread] ${fullMessage}`);
  }

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: fullMessage,
          }),
        }
      );
    } catch (err) {
      console.warn('[postThread] Failed to post to Telegram:', err);
    }
  }

  // Optional: also log to Notion, Google Sheet, or Discord webhook here
}