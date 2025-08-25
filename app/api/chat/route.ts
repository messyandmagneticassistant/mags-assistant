import { NextRequest } from 'next/server';
import { checkAuth } from '../../../lib/auth';
import { getOpenAI } from '../../../lib/clients/openai';
import * as ops from '../../../lib/tools';

const systemPrompt = `You are Mags, Chanel's branded operations assistant for Messy & Magnetic. You speak warmly, clearly, and act decisively. You can:
1) Keep the 'MM Stripe Product Tracker' in Notion and Stripe products fully in sync.
2) Generate on-brand product images with DALL·E in the Messy & Magnetic aesthetic (sage/blush/cream, soft light, dreamy but clean), attach to Stripe and Notion.
3) Audit Stripe product 'Tax code, shippable, metadata, images, SEO, default_price, statement_descriptor, deprecation flags' and propose safe fixes; ask before applying bulk changes.
4) Create/assign/update tasks in Notion; move items across statuses Draft → Ready to Add → Added in Stripe → Needs Edit; add 'Date Updated'.
5) Schedule and run jobs (via our queue DB); log outcomes; notify Chanel when important things finish or fail.
6) Respect budgets and safety. Never change prices without a suggestion/confirmation.

Always:
- Confirm assumptions that cost money or change customer-facing details.
- Summarize what you'll do; when done, post a Notion comment + send a notification if configured.
- Use today's real date/time.`;

const toolDefs: any[] = [
  {
    type: 'function',
    function: {
      name: 'syncStripeNotion',
      parameters: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['pull', 'push', 'twoWay'] } },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'genProductImage',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          promptOverride: { type: 'string', nullable: true },
        },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'auditStripe',
      parameters: {
        type: 'object',
        properties: {
          fix: { type: 'boolean', nullable: true },
          scope: { type: 'string', enum: ['all', 'changed', 'missing'], nullable: true },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createNotionTask',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          details: { type: 'string' },
          status: { type: 'string', nullable: true },
        },
        required: ['title', 'details'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string' },
          title: { type: 'string' },
          message: { type: 'string' },
          links: { type: 'array', items: { type: 'string' }, nullable: true },
        },
        required: ['level', 'title', 'message'],
      },
    },
  },
];

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = await req.json();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const client = getOpenAI();
  const convo: any[] = [{ role: 'system', content: systemPrompt }, ...messages];

  while (true) {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: convo,
      tools: toolDefs,
    });
    const msg = resp.choices[0].message;
    if (msg.tool_calls && msg.tool_calls.length) {
      for (const call of msg.tool_calls) {
        const fn = (ops as any)[call.function.name];
        let result: any = { error: 'unknown tool' };
        if (fn) {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          result = await fn(args);
        }
        convo.push({ role: 'assistant', content: '', tool_calls: [call] });
        convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }
    const content = msg.content || '';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' },
    });
  }
}
