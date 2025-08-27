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
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/telegram-webhook") {
      return handleTelegramWebhook(request);
    }

    return new Response("🧠 Maggie is running (fetch handler online).");
  }
};