import { onRequestGet as health, diagConfig } from "./health";

type Ctx = { env: any; request: Request; ctx: ExecutionContext };

async function tryRoute<T extends Record<string, any>>(
  pathPrefix: string,
  modPath: string,
  handlerName: string | null,
  req: Request,
  env: any,
  ctx: ExecutionContext
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(pathPrefix)) return null;

  try {
    const mod: T = (await import(modPath)) as T;

    if (handlerName && typeof (mod as any)[handlerName] === "function") {
      return await (mod as any)[handlerName](req, env, ctx);
    }

    if (typeof (mod as any).onRequest === "function") {
      return await (mod as any).onRequest({ request: req, env, ctx });
    }
    const methodKey =
      req.method === "GET" ? "onRequestGet"
      : req.method === "POST" ? "onRequestPost"
      : req.method === "PUT" ? "onRequestPut"
      : req.method === "DELETE" ? "onRequestDelete"
      : null;

    if (methodKey && typeof (mod as any)[methodKey] === "function") {
      return await (mod as any)[methodKey]({ request: req, env, ctx });
    }

    if (typeof (mod as any).handle === "function") {
      return await (mod as any).handle(req, env, ctx);
    }

    return new Response("Route module loaded but no handler found.", { status: 500 });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return (health as any)({ env });
    }
    if (url.pathname === "/diag/config" && req.method === "GET") {
      return (diagConfig as any)({ env });
    }

    const tik = await tryRoute("/tiktok/", "./routes/tiktok", null, req, env, ctx);
    if (tik && tik.status !== 404) return tik;

    const tasks = await tryRoute("/tasks/", "./routes/tasks", null, req, env, ctx);
    if (tasks && tasks.status !== 404) return tasks;

    const cron = await tryRoute("/cron/", "./routes/cron", null, req, env, ctx);
    if (cron && cron.status !== 404) return cron;

    if (url.pathname === "/ready") {
      try {
        const r: any = await import("./routes/ready");
        if (typeof r.onRequestGet === "function") {
          return await r.onRequestGet({ request: req, env, ctx });
        }
        if (typeof r.handle === "function") {
          return await r.handle(req, env, ctx);
        }
      } catch {}
      return new Response("ready route not installed", { status: 404 });
    }

    return new Response("mags ok", { status: 200, headers: { "content-type": "text/plain" } });
  },
};
