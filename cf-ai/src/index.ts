export interface Env {
  AI: any;
  CONFIGS: KVNamespace;
}

const ALLOWED_ORIGINS = [
  'https://assistant.messyandmagnetic.com',
  'https://messyandmagnetic.com',
];

function isAllowedOrigin(origin: string): boolean {
  return (
    ALLOWED_ORIGINS.includes(origin) ||
    /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)
  );
}

function cors(origin: string) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function handleOptions(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...cors(origin),
      'Access-Control-Max-Age': '86400',
    },
  });
}

const systemPrompt =
  "Messy & Magnetic—funny, warm, validating, clever; sneak in soulful blueprint CTA when natural (‘Take the Soul Blueprint quiz at messyandmagnetic.com’).";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      return handleOptions(origin);
    }

    const url = new URL(request.url);

    if (url.pathname === '/analyze' && request.method === 'POST') {
      return analyze(request, env, origin);
    }

    if (url.pathname === '/rank' && request.method === 'POST') {
      return rank(request, env, origin);
    }

    if (url.pathname === '/config' && request.method === 'GET') {
      return getConfig(url, env, origin);
    }

    return new Response('Not found', {
      status: 404,
      headers: cors(origin),
    });
  },
};

async function analyze(request: Request, env: Env, origin: string) {
  const { text } = await request.json<{ text?: string }>();
  if (!text) {
    return new Response('Missing text', {
      status: 400,
      headers: cors(origin),
    });
  }

  const userPrompt = `Analyze the following content. Classify tone (funny, validating, heart-string, hype). Provide a short summary and up to 3 hashtags. Suggest 3-5 organic comments and one reply thread (array of two messages). Keep suggestions short, non-spammy, and natural; avoid obvious self-promo unless context asks. Return JSON with keys: tone, summary, hashtags (array), comments (array), replies (array of arrays). Text:\n"""${text}"""`;

  const aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  let data: unknown;
  try {
    data = JSON.parse(aiResp.response || '{}');
  } catch (err) {
    data = { error: 'Invalid AI response' };
  }

  return new Response(JSON.stringify(data), {
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

async function rank(request: Request, env: Env, origin: string) {
  const { items } = await request.json<{ items?: Array<{ id: string; title?: string; desc?: string; transcript?: string }> }>();
  if (!Array.isArray(items)) {
    return new Response('Missing items', {
      status: 400,
      headers: cors(origin),
    });
  }

  const itemPrompt = items
    .map((it) => `ID: ${it.id}\nTitle: ${it.title || ''}\nDescription: ${it.desc || ''}\nTranscript: ${it.transcript || ''}`)
    .join('\n\n');

  const userPrompt = `Score each item for GOLD potential (0-100) based on Originality, Hook strength, Relatability, Punchline/Insight, Clarity, and On-brand fit. Provide a brief rationale for each. Return JSON: {"items":[{"id":"...","score":0,"rationale":"..."}]}\n\nItems:\n${itemPrompt}`;

  const aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  let data: any = { items: [] };
  try {
    data = JSON.parse(aiResp.response || '{}');
  } catch (err) {
    data = { items: [], error: 'Invalid AI response' };
  }

  const sorted = Array.isArray(data.items)
    ? data.items.sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
    : [];

  return new Response(JSON.stringify({ items: sorted }), {
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

async function getConfig(url: URL, env: Env, origin: string) {
  const key = url.searchParams.get('key');
  if (!key) {
    return new Response('Missing key', {
      status: 400,
      headers: cors(origin),
    });
  }

  const value = await env.CONFIGS.get(key, 'json');
  if (value === null) {
    return new Response('Not found', {
      status: 404,
      headers: cors(origin),
    });
  }

  return new Response(JSON.stringify(value), {
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}
