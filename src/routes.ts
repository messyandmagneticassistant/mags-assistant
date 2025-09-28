import { sendTelegramMessage } from '../lib/telegram';

type RouteHandler = (request: Request) => Promise<Response> | Response;

type RouteDefinition = {
  method: string;
  path: string;
  handler: RouteHandler;
};

function json(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function hasJsonMethod(value: unknown): value is { json: () => Promise<unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { json?: unknown }).json === 'function'
  );
}

export const routes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/ping-debug',
    handler: async (_request: Request) => {
      const message = '📡 Ping received!';
      try {
        const resp = await sendTelegramMessage(message);

        const status =
          typeof resp === 'object' &&
          resp !== null &&
          'status' in resp &&
          typeof (resp as { status?: unknown }).status === 'number'
            ? (resp as { status: number }).status
            : 200;

        const data = hasJsonMethod(resp)
          ? await resp.json()
          : typeof resp === 'object' && resp !== null && 'resp' in resp
            ? (resp as { resp: unknown }).resp
            : resp;

        return json({
          ok: true,
          status,
          data,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Telegram send failed';
        return json({
          ok: false,
          error,
        });
      }
    },
  },
];

export default routes;
