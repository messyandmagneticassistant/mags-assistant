// 📍 File: workers/telegram-webhook.ts

import { dispatch } from '../maggie/intent-router';
import { loadSecretsFromBlob } from '../utils/loadSecretsFromBlob';
import { reportStatus } from '../lib/reportStatus';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Only POST allowed', { status: 405 });
    }

    try {
      await loadSecretsFromBlob();

      const body = await request.json();
      const message = body?.message;
      const text = message?.text?.trim();
      const chatId = message?.chat?.id;

      if (!text || !chatId) {
        return new Response('No valid message found', { status: 400 });
      }

      console.log(`[telegram-webhook] Message from ${chatId}:`, text);
      await reportStatus(`💬 <b>Telegram</b>: <code>${text}</code>`);
      await dispatch(text, { source: 'telegram' });

      return new Response('OK');
    } catch (err) {
      console.error('[telegram-webhook] Error:', err);
      return new Response('Internal error', { status: 500 });
    }
  },
};