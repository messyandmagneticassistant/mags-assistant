export interface Env {
  WORKER_KEY: string;
}

const CONFIGS: Record<string, any> = {
  google: {
    serviceAccount: "__REPLACE_IN_CLOUDFLARE_DASH__",
    oauthClient: "__REPLACE_IN_CLOUDFLARE_DASH__",
    redirect: "__REPLACE_IN_CLOUDFLARE_DASH__",
    projectId: "__REPLACE_IN_CLOUDFLARE_DASH__"
  },
  notion: {
    token: "__REPLACE_IN_CLOUDFLARE_DASH__",
    rootPageId: "__REPLACE_IN_CLOUDFLARE_DASH__",
    hqPageId: "__REPLACE_IN_CLOUDFLARE_DASH__",
    queueDb: "__REPLACE_IN_CLOUDFLARE_DASH__",
    domain: "__REPLACE_IN_CLOUDFLARE_DASH__"
  },
  browserless: {
    base: "__REPLACE_IN_CLOUDFLARE_DASH__",
    apiKey: "__REPLACE_IN_CLOUDFLARE_DASH__",
    token: "__REPLACE_IN_CLOUDFLARE_DASH__"
  },
  stripe: {
    secretKey: "__REPLACE_IN_CLOUDFLARE_DASH__",
    webhookSecret: "__REPLACE_IN_CLOUDFLARE_DASH__"
  },
  tally: {
    apiKey: "__REPLACE_IN_CLOUDFLARE_DASH__",
    quizWebhookSecret: "__REPLACE_IN_CLOUDFLARE_DASH__",
    feedbackWebhookSecret: "__REPLACE_IN_CLOUDFLARE_DASH__"
  },
  telegram: {
    botToken: "__REPLACE_IN_CLOUDFLARE_DASH__",
    chatId: "__REPLACE_IN_CLOUDFLARE_DASH__"
  },
  github: {
    token: "__REPLACE_IN_CLOUDFLARE_DASH__"
  }
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const auth = req.headers.get("authorization") || "";
    const expected = `Bearer ${env.WORKER_KEY}`;
    if (auth !== expected) {
      return new Response("unauthorized", { status: 401 });
    }
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/config") {
      const scope = url.searchParams.get("scope") || "";
      const data = CONFIGS[scope];
      if (!data) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  }
};
