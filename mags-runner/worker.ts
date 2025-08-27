// worker.ts
import { handleTelegramWebhook } from './src/handlers/telegram';
import { runMaggie } from './maggie/index';

export default {
  // 🔁 Called every 10 minutes by your cron trigger
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('⏰ mags-runner tick at', event.cron);
    ctx.waitUntil(runMaggie({ force: false }));
  },

  // 🌐 Handles external HTTP requests
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/telegram-webhook") {
      try {
        return await handleTelegramWebhook(request);
      } catch (err) {
        console.error("[worker] Telegram webhook error:", err);
        return new Response("Error handling Telegram webhook", { status: 500 });
      }
    }

    return new Response("🧠 Maggie is online and running.", {
      headers: { "Content-Type": "text/plain" },
    });
  }
};