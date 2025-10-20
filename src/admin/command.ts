export default {
  async fetch(req: Request, env: Record<string, any>) {
    const url = new URL(req.url);
    if (url.pathname !== '/api/maggie/command') {
      return new Response('Not Found', { status: 404 });
    }

    const auth = req.headers.get('Authorization');
    if (auth !== `Bearer ${env.ADMIN_SHARED_SECRET}`) {
      return new Response('Unauthorized', { status: 403 });
    }

    try {
      const { action, payload } = await req.json();

      if (action === 'deploy') {
        const res = await env.__MaggieDeploy(payload);
        return new Response(
          JSON.stringify({ ok: true, deploy: res }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (action === 'sync') {
        const res = await env.__MaggieSync(payload);
        return new Response(
          JSON.stringify({ ok: true, sync: res }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (action === 'restart') {
        const res = await fetch(`${env.WORKER_URL}/maggie/restart`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.INTERNAL_ADMIN_TOKEN}` },
        });
        return new Response(
          await res.text(),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ ok: false, error: 'Unknown action' }),
        { status: 400 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(
        JSON.stringify({ ok: false, error: message }),
        { status: 500 },
      );
    }
  },
};
