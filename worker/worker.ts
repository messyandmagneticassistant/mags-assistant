import { onRequestGet as health, diagConfig } from "./health";

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === "/health" && req.method === "GET") return health({ env } as any);
    if (url.pathname === "/diag/config" && req.method === "GET") return diagConfig({ env } as any);
    return new Response("mags ok", { status: 200 });
  }
};
