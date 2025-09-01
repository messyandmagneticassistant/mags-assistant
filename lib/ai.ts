// src/lib/ai.ts
// Unified chat client for Maggie
// - OpenAI primary (OPENAI_API_KEY)
// - GitHub Models fallback (GITHUB_TOKEN)
// - Streaming + non-streaming
// - System prompt builder with Notion/Stripe context

type Role = "system" | "user" | "assistant";
export type ChatMessage = { role: Role; content: string };

export type ChatOptions = {
  openaiModel?: string;       // default: gpt-5
  githubModel?: string;       // default: openai/gpt-5
  temperature?: number;       // default: 0.2
  maxTokens?: number;
  stream?: boolean;           // default: false
  retries?: number;           // default: 2
  timeoutMs?: number;         // default: 60_000
};

const DEFAULTS = {
  openaiModel: "gpt-5",
  githubModel: "openai/gpt-5",
  temperature: 0.2,
  retries: 2,
  timeoutMs: 60_000,
};

// --------------------
// Utility helpers
// --------------------
function getEnv(name: string): string | undefined {
  return (globalThis as any).process?.env?.[name] ?? (globalThis as any)[name];
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // @ts-ignore
    return await p;
  } finally {
    clearTimeout(t);
  }
}

async function postJSON(
  url: string,
  headers: Record<string, string>,
  body: any,
  timeoutMs: number
) {
  const res = await withTimeout(
    fetch(url, { method: "POST", headers, body: JSON.stringify(body) }),
    timeoutMs
  );
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, text, res };
}

// --------------------
// OpenAI client
// --------------------
async function callOpenAI(messages: ChatMessage[], opts: ChatOptions) {
  const key = getEnv("OPENAI_API_KEY");
  if (!key) throw new Error("Missing OPENAI_API_KEY");

  const { openaiModel, temperature, maxTokens, stream, timeoutMs } = {
    ...DEFAULTS,
    ...opts,
  };

  const { ok, status, json, text, res } = await postJSON(
    "https://api.openai.com/v1/chat/completions",
    {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    {
      model: openaiModel,
      temperature,
      max_tokens: maxTokens,
      stream: !!stream,
      messages,
    },
    timeoutMs!
  );

  if (!ok) throw new Error(`OpenAI error ${status}: ${text}`);

  if (stream) return res; // caller handles streaming
  const content = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "openai" as const, content, raw: json };
}

// --------------------
// GitHub Models fallback
// --------------------
async function callGitHubModels(messages: ChatMessage[], opts: ChatOptions) {
  const token = getEnv("GITHUB_TOKEN");
  if (!token) throw new Error("Missing GITHUB_TOKEN");

  const { githubModel, temperature, maxTokens, timeoutMs } = {
    ...DEFAULTS,
    ...opts,
  };

  const { ok, status, json, text } = await postJSON(
    "https://models.github.ai/inference/v1/chat/completions",
    {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    {
      model: githubModel,
      temperature,
      max_tokens: maxTokens,
      messages,
    },
    timeoutMs!
  );

  if (!ok) throw new Error(`GitHub Models error ${status}: ${text}`);
  const content = json?.choices?.[0]?.message?.content ?? "";
  return { provider: "github" as const, content, raw: json };
}

// --------------------
// Unified entry point
// --------------------
export async function chat(messages: ChatMessage[], options: ChatOptions = {}) {
  const opts = { ...DEFAULTS, ...options };

  // Try OpenAI first if available
  if (getEnv("OPENAI_API_KEY")) {
    try {
      return await callOpenAI(messages, opts);
    } catch (err) {
      console.warn("OpenAI failed, falling back:", err);
    }
  }

  // Fallback to GitHub Models
  if (getEnv("GITHUB_TOKEN")) {
    return await callGitHubModels(messages, opts);
  }

  throw new Error("No provider available (set OPENAI_API_KEY or GITHUB_TOKEN)");
}

// --------------------
// JSON convenience
// --------------------
export async function chatJSON<T = any>(
  systemPrompt: string,
  userPrompt: string,
  options: ChatOptions = {}
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${systemPrompt}\nReturn only valid JSON.` },
    { role: "user", content: userPrompt },
  ];
  const res = await chat(messages, options);
  const cleaned = res.content.trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "");
  return JSON.parse(cleaned) as T;
}

// --------------------
// System prompt builder
// --------------------
export function buildSystemPrompt() {
  let prompt = "You are Mags, the Messy and Magnetic assistant.";
  const parts: string[] = [];

  if (getEnv("NOTION_API_KEY") && getEnv("NOTION_DB_ID")) {
    parts.push(`You can access Notion. DB ID ${getEnv("NOTION_DB_ID")}.`);
  }
  if (getEnv("STRIPE_SECRET_KEY")) {
    parts.push("You can access Stripe APIs.");
  }
  if (parts.length) prompt += " " + parts.join(" ");
  return prompt;
}