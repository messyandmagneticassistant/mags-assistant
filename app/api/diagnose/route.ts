import { NextRequest } from 'next/server';
import { geminiSuggestFix } from '../../../lib/gemini';
import { tgSend } from '../../../lib/telegram';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const pass = process.env.NEXT_PUBLIC_FETCH_PASS;
  if (!pass) return Response.json({ ok:false, missing:["NEXT_PUBLIC_FETCH_PASS"] });

  const auth = req.headers.get('x-fetch-pass') || req.nextUrl.searchParams.get('pass');
  if (auth !== pass) return new Response(JSON.stringify({ ok:false, error:"BAD_PASS" }), { status:401 });

  const missing = ["STRIPE_WEBHOOK_SECRET","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID"].filter(v => !process.env[v]);
  const contextParts: string[] = [];
  contextParts.push(`MISSING_ENV=${missing.join(',') || 'none'}`);

  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin;
  const urls = ["/api/ping","/api/stripe-webhook-test","/api/check"].map(u => base + u);
  for (const u of urls) {
    try {
      const r = await fetch(u);
      contextParts.push(`${u} -> ${r.status}`);
      const txt = await r.text();
      contextParts.push(`body: ${txt.slice(0,500)}`);
    } catch(e) {
      contextParts.push(`${u} -> ERROR ${e}`);
    }
  }

  const context = contextParts.join("\n");
  const g = await geminiSuggestFix(context);
  if (g.ok) {
    await tgSend(`💡 Gemini suggests:\n${g.text.slice(0,3500)}`);
    return Response.json({ ok:true, suggestion:g.text });
  } else {
    return Response.json({ ok:false, reason:g.reason, context });
  }
}
