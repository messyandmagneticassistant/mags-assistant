import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '../../../../utils/config';
import { updateNotionOrder } from '../../../../lib/notionSync';
import { calculatePrice, PriceParams } from '../../../../lib/fulfillment';
import { exec as cpExec } from 'node:child_process';
import { promisify } from 'node:util';
import { routeTelegramCommand } from '../../../../src/telegram/router.ts';

const exec = promisify(cpExec);

async function sendTelegram(text: string, cfg: any) {
  await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text }),
  });
}

const TELEGRAM_COMMANDS: Record<string, string> = {
  '/deliver_reading': 'Deliver latest reading to client',
  '/resend_reading': 'Resend latest reading to client',
  '/syncstripe': 'Trigger Stripe sync',
  '/syncnotion': 'Trigger Notion update',
  '/fallback': 'Run all fallback automations',
  '/chartupdate': 'Regenerate all charts for latest order',
  '/bundlemap': 'Trigger rhythm icon generator',
  '/reprice': 'Recalculate pricing and sync Stripe',
  '/stripe_sync': 'Run Stripe product sync',
  '/quote': 'Return pricing estimate',
};

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
    const cfg = await getConfig('telegram');
    const allowed = cfg.chatId;

    if (update.callback_query) {
      const chatId = String(update.callback_query.message?.chat?.id ?? '');
      if (allowed && chatId === String(allowed)) {
        try {
          const data = JSON.parse(update.callback_query.data || '{}');
          await fetch(`${process.env.API_BASE ?? ''}/api/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
        } catch {}
      }
      try {
        await fetch(`https://api.telegram.org/bot${cfg.botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: update.callback_query.id }),
        });
      } catch {}
      return NextResponse.json({ ok: true });
    }

    const msg = update.message ?? update.edited_message;
    const chatId = String(msg?.chat?.id ?? '');
    const text: string = msg?.text ?? '';

    if (!text || !allowed || chatId !== String(allowed)) {
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/')) {
      try {
        const routed = await routeTelegramCommand({
          text,
          chatId,
          reply: (message) => sendTelegram(message, cfg),
        });
        if (routed) {
          return NextResponse.json({ ok: true });
        }
      } catch (err) {
        console.error('[telegram:webhook] Router error', err);
      }

      const [cmd, ...args] = text.split(' ');
      const base = process.env.API_BASE ?? '';
      switch (cmd) {
        case '/status':
          await sendTelegram('🧠 MAGI is running and synced to latest codebase.', cfg);
          break;
        case '/latest':
          try {
            const r = await fetch('https://messyandmagnetic.com/api/latest-reading');
            const j = await r.json();
            await sendTelegram(`📄 Last reading generated:\n\n${j.title}\n${j.url}`, cfg);
          } catch {
            await sendTelegram('Failed to fetch latest reading.', cfg);
          }
          break;
        case '/sync_notion':
          try {
            const result = await updateNotionOrder();
            await sendTelegram(`🔄 Synced ${result.count} orders with Notion`, cfg);
          } catch {
            await sendTelegram('Failed to sync Notion.', cfg);
          }
          break;
        case '/gen':
          if (args[0] === 'filler') {
            await fetch(`${base}/api/gen/filler`, { method: 'POST' }).catch(() => {});
            await sendTelegram('Generating filler content.', cfg);
          } else {
            await sendTelegram('Unknown /gen command', cfg);
          }
          break;
        case '/post':
          if (args[0] === 'now') {
            await fetch(`${base}/api/post/now`, { method: 'POST' }).catch(() => {});
            await sendTelegram('Posting queued clip.', cfg);
          } else {
            await sendTelegram('Unknown /post command', cfg);
          }
          break;
        case '/clip':
          if (args[0] === 'last') {
            await fetch(`${base}/api/clip/last`, { method: 'POST' }).catch(() => {});
            await sendTelegram('Clipping last video.', cfg);
          } else {
            await sendTelegram('Unknown /clip command', cfg);
          }
          break;
        case '/syncstripe':
          await fetch(`${base}/api/stripe/sync/run`, { method: 'POST' }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/syncstripe'], cfg);
          break;
        case '/syncnotion':
          await fetch(`${base}/api/notion/order-update`, { method: 'POST' }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/syncnotion'], cfg);
          break;
        case '/fallback':
          await fetch(`${base}/api/fallback/run`, { method: 'POST' }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/fallback'], cfg);
          break;
        case '/chartupdate':
          await fetch(`${base}/api/readings/chart-update`, { method: 'POST' }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/chartupdate'], cfg);
          break;
        case '/bundlemap':
          await fetch(`${base}/api/magnet/bundle-map`, { method: 'POST' }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/bundlemap'], cfg);
          break;
        case '/fallback_sync_prices':
          await exec('npm run prices:sync');
          await sendTelegram('✅ Stripe prices resynced from JSON.', cfg);
          break;
        case '/fallback_generate_doc':
          await exec('npm run browserless:google-doc-generation');
          await sendTelegram('📝 Google Doc generation task triggered.', cfg);
          break;
        case '/fallback_check_quiz_embed':
          await exec('npm run browserless:quiz-confirmation-check');
          await sendTelegram('🔍 Quiz embed check triggered.', cfg);
          break;
        case '/sync_notion_backup':
          await exec('node scripts/notion-sync.ts');
          await sendTelegram('📚 Notion backup sync executed.', cfg);
          break;
        case '/deliver_reading':
          await fetch(`${base}/api/readings/deliver`, { method: 'POST' }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/deliver_reading'], cfg);
          break;
        case '/resend_reading': {
          const params = Object.fromEntries(args.map((a) => a.split('=')));
          const body = {
            personId: params['personId'] || params['id'] || '',
            method: params['method'],
            force: params['force'] === 'true',
            reason: params['reason'],
          };
          await fetch(`${base}/api/readings/resend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).catch(() => {});
          await sendTelegram(TELEGRAM_COMMANDS['/resend_reading'], cfg);
          break;
        }
        case '/reprice': {
          const params = Object.fromEntries(args.map((a) => a.split('=')));
          const priceParams: PriceParams = {
            tier: (params['tier'] || 'mini') as any,
            numPeople: parseInt(params['numPeople'] || params['people'] || '1', 10),
            numAddons: parseInt(params['numAddons'] || '0', 10),
            isChild: params['isChild'] === 'true' || params['child'] === 'true',
            isBundle: params['isBundle'] === 'true',
            isAddon: params['isAddon'] === 'true',
          };
          const result = calculatePrice(priceParams);
          await sendTelegram(
            `Reprice total $${result.total.toFixed(2)} -> ${result.summary}`,
            cfg,
          );
          break;
        }
        case '/stripe_sync':
          await exec('npm run stripe:sync');
          await sendTelegram(TELEGRAM_COMMANDS['/stripe_sync'], cfg);
          break;
        case '/quote': {
          const params = Object.fromEntries(args.map((a) => a.split('=')));
          const priceParams: PriceParams = {
            tier: (params['tier'] || 'mini') as any,
            numPeople: parseInt(params['people'] || params['count'] || '1', 10),
            numAddons: params['addons'] ? params['addons'].split(',').length : 0,
            isChild: params['child'] === 'true',
          };
          const result = calculatePrice(priceParams);
          const pp = result.total / (priceParams.numPeople || 1);
          await sendTelegram(
            `Quote for ${priceParams.tier} x${priceParams.numPeople}: $${result.total.toFixed(2)} (pp $${pp.toFixed(2)})`,
            cfg,
          );
          break;
        }
        default:
          await sendTelegram('Unknown command', cfg);
      }
    } else {
      await sendTelegram("Got it! I’ll process this soon.", cfg);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'tg-webhook-failed' }, { status: 500 });
  }
}
