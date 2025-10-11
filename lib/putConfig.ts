import { putConfig as putConfigToCloudflare } from './kv';
import { getBrain } from './getBrain';

type AnyEnv = Record<string, unknown> & {
  BRAIN?: { get: (key: string, type?: unknown) => Promise<string | null> };
  POSTQ_KV_ID?: string;
  POSTQ_KV_NAMESPACE?: string;
  POSTQ_KV_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;
  ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CF_API_TOKEN?: string;
  API_TOKEN?: string;
  CF_KV_POSTQ_NAMESPACE_ID?: string;
  CF_KV_NAMESPACE_ID?: string;
};

const FRONT_MATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const KV_BRAIN_KEY = 'PostQ:thread-state';

function parseScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function countIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count += 1;
    else if (ch === '\t') count += 2;
    else break;
  }
  return count;
}

function peekNext(lines: string[], start: number): { index: number; indent: number; trimmed: string } | null {
  for (let i = start; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    return { index: i, indent: countIndent(lines[i]), trimmed };
  }
  return null;
}

function parseArray(lines: string[], start: number, indent: number): { value: unknown[]; index: number } {
  const items: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }
    const currentIndent = countIndent(raw);
    if (currentIndent < indent || !trimmed.startsWith('- ')) {
      break;
    }
    const valuePart = trimmed.slice(2).trim();
    if (valuePart.length === 0) {
      const nested = parseBlock(lines, i + 1, indent + 2);
      items.push(nested.value);
      i = nested.index;
    } else {
      items.push(parseScalar(valuePart));
      i += 1;
    }
  }
  return { value: items, index: i };
}

function parseBlock(
  lines: string[],
  start: number,
  indent: number
): { value: Record<string, unknown> | unknown[]; index: number } {
  const result: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }
    const currentIndent = countIndent(raw);
    if (currentIndent < indent) {
      break;
    }
    if (trimmed.startsWith('- ')) {
      const arr = parseArray(lines, i, currentIndent);
      return { value: arr.value, index: arr.index };
    }
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      i += 1;
      continue;
    }
    const key = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (remainder.length === 0) {
      const next = peekNext(lines, i + 1);
      if (!next || next.indent <= currentIndent) {
        result[key] = {};
        i += 1;
        continue;
      }
      if (next.trimmed.startsWith('- ')) {
        const arr = parseArray(lines, next.index, next.indent);
        result[key] = arr.value;
        i = arr.index;
      } else {
        const block = parseBlock(lines, next.index, next.indent);
        result[key] = block.value;
        i = block.index;
      }
    } else {
      result[key] = parseScalar(remainder);
      i += 1;
    }
  }
  return { value: result, index: i };
}

function parseFrontMatter(raw: string): { data: Record<string, unknown> | null; warnings: string[] } {
  const warnings: string[] = [];
  const lines = raw.split(/\r?\n/);
  try {
    const parsed = parseBlock(lines, 0, 0).value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, warnings };
    }
    warnings.push('front-matter-not-object');
  } catch (err) {
    warnings.push('front-matter-parse-failed');
    console.warn('[putBrainToKV] Failed to parse front matter', err);
  }
  return { data: null, warnings };
}

function parseBrainMarkdown(raw: string): {
  content: string;
  frontMatter: Record<string, unknown> | null;
  frontMatterRaw: string | null;
  warnings: string[];
} {
  const match = raw.match(FRONT_MATTER_REGEX);
  if (!match) {
    console.warn('[putBrainToKV] brain.md missing front matter header');
    return { content: raw.trimStart(), frontMatter: null, frontMatterRaw: null, warnings: ['missing-front-matter'] };
  }
  const [, frontMatterBlock] = match;
  const content = raw.slice(match[0].length).trimStart();
  const parsed = parseFrontMatter(frontMatterBlock);
  const warnings = [...parsed.warnings];
  if (!parsed.data) warnings.push('front-matter-empty');
  return { content, frontMatter: parsed.data, frontMatterRaw: frontMatterBlock, warnings };
}

function pickFirstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickAccountId(env: AnyEnv): string | undefined {
  return pickFirstString(env.POSTQ_KV_ID, env.CLOUDFLARE_ACCOUNT_ID, env.CF_ACCOUNT_ID, env.ACCOUNT_ID);
}

function pickNamespaceId(env: AnyEnv): string | undefined {
  return pickFirstString(env.POSTQ_KV_NAMESPACE, env.CF_KV_POSTQ_NAMESPACE_ID, env.CF_KV_NAMESPACE_ID);
}

function pickApiToken(env: AnyEnv): string | undefined {
  return pickFirstString(env.POSTQ_KV_TOKEN, env.CLOUDFLARE_API_TOKEN, env.CF_API_TOKEN, env.API_TOKEN);
}

function textSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type PutBrainResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  warnings?: string[];
  syncedAt?: string;
  bytes?: number;
};

export async function putBrainToKV(env: AnyEnv): Promise<PutBrainResult> {
  const brainMarkdown = await getBrain(env);
  if (!brainMarkdown || brainMarkdown.trim().length === 0) {
    console.warn('[putBrainToKV] brain.md fetch returned empty payload');
    return { ok: false, skipped: true, reason: 'brain-empty' };
  }

  const parsed = parseBrainMarkdown(brainMarkdown);
  const warnings = [...(parsed.warnings ?? [])];

  let existing: Record<string, unknown> = {};
  try {
    const kv = env.BRAIN;
    if (kv && typeof kv.get === 'function') {
      const raw = await kv.get(KV_BRAIN_KEY);
      if (raw) {
        existing = JSON.parse(raw);
      }
    }
  } catch (err) {
    warnings.push('existing-state-read-failed');
    console.warn('[putBrainToKV] Unable to read existing KV state', err);
  }

  const syncedAt = new Date().toISOString();
  const brainEntry = {
    markdown: brainMarkdown,
    content: parsed.content,
    frontMatter: parsed.frontMatter,
    frontMatterRaw: parsed.frontMatterRaw,
    warnings: warnings.length ? warnings : undefined,
    syncedAt,
  };

  const nextState = { ...existing, brain: brainEntry };
  const json = JSON.stringify(nextState, null, 2);

  const accountId = pickAccountId(env);
  const namespaceId = pickNamespaceId(env);
  const apiToken = pickApiToken(env);

  await putConfigToCloudflare(KV_BRAIN_KEY, json, {
    accountId,
    namespaceId,
    apiToken,
    contentType: 'application/json',
  });

  const bytes = textSize(json);
  console.log('[putBrainToKV] Updated brain blob in KV', { key: KV_BRAIN_KEY, bytes });
  return { ok: true, syncedAt, bytes, warnings: warnings.length ? warnings : undefined };
}

export const putConfig = putConfigToCloudflare;
