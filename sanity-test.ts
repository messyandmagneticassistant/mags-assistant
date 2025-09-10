import { onRequestGet, onRequestPost } from './worker/routes/admin';

const env: any = {
  ENABLE_SOCIAL_POSTING: 'false',
  BRAIN: {
    get: async (_: string) => null,
    put: async (_: string, __: string) => {},
    list: async () => ({ keys: [] }),
  },
  POSTQ: {
    get: async (_: string) => null,
    put: async (_: string, __: string) => {},
  },
};

async function run() {
  let res = await onRequestGet({ request: new Request('http://x/health'), env });
  console.log('GET /health', await res.json());

  res = await onRequestGet({ request: new Request('http://x/admin/social-mode'), env });
  console.log('GET /admin/social-mode', await res.json());

  res = await onRequestPost({ request: new Request('http://x/admin/trigger', { method: 'POST', body: JSON.stringify({ kind: 'trends' }) }), env });
  console.log('POST /admin/trigger trends', await res.json());

  res = await onRequestPost({ request: new Request('http://x/admin/trigger', { method: 'POST', body: JSON.stringify({ kind: 'plan' }) }), env });
  console.log('POST /admin/trigger plan', await res.json());

  res = await onRequestPost({ request: new Request('http://x/admin/trigger', { method: 'POST', body: JSON.stringify({ kind: 'run' }) }), env });
  console.log('POST /admin/trigger run', await res.json());
}

run();
