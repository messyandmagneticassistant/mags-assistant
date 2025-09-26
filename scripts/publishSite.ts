import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { sendTelegramMessage } from './lib/telegramClient';
import { sendCompletionPing } from '../lib/telegram';

const SITE_PREFIX = 'site:';
const RESERVED_KEYS = new Set([`${SITE_PREFIX}manifest`]);

interface PublishSiteOptions {
  triggeredBy?: string;
  notify?: boolean;
}

interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
  namespaceId: string;
}

interface SiteAssetRecord {
  path: string;
  contentType: string;
  encoding: 'base64';
  content: string;
  hash: string;
  size: number;
  deployedAt: string;
}

interface PublishSiteResult {
  manifest: {
    generatedAt: string;
    triggeredBy?: string;
    assetCount: number;
    assets: Record<string, {
      hash: string;
      size: number;
      contentType: string;
      deployedAt: string;
    }>;
  };
  removedKeys: string[];
}

function ensureSiteDir(): string {
  const dir = path.resolve('site');
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readSiteFiles(baseDir: string): Promise<string[]> {
  async function walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }

  return walk(baseDir);
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function toBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getCloudflareCredentials(): CloudflareCredentials {
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    '';
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    '';
  const namespaceId =
    process.env.CF_KV_POSTQ_NAMESPACE_ID ||
    process.env.CF_KV_NAMESPACE_ID ||
    '';

  if (!accountId || !apiToken || !namespaceId) {
    throw new Error(
      'Missing Cloudflare credentials. Ensure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CF_KV_POSTQ_NAMESPACE_ID are set.',
    );
  }

  return { accountId, apiToken, namespaceId };
}

async function putKvValue(
  creds: CloudflareCredentials,
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/storage/kv/namespaces/${creds.namespaceId}`;
  const url = `${base}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      'Content-Type': contentType,
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Failed to write ${key}: ${res.status}${detail ? ` ${detail}` : ''}`);
  }
}

async function deleteKvKey(creds: CloudflareCredentials, key: string): Promise<void> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/storage/kv/namespaces/${creds.namespaceId}`;
  const url = `${base}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
    },
  });

  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Failed to delete ${key}: ${res.status}${detail ? ` ${detail}` : ''}`);
  }
}

async function listExistingSiteKeys(creds: CloudflareCredentials): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  const base = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/storage/kv/namespaces/${creds.namespaceId}/keys`;

  do {
    const previousCursor = cursor;
    const url = new URL(base);
    url.searchParams.set('prefix', SITE_PREFIX);
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${creds.apiToken}` },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Failed to list site keys: ${res.status}${detail ? ` ${detail}` : ''}`);
    }

    const data: any = await res.json();
    const result = Array.isArray(data?.result) ? data.result : [];
    for (const entry of result) {
      if (entry?.name) keys.add(String(entry.name));
    }

    const info = data?.result_info ?? {};
    const nextCursor = typeof info.cursor === 'string' && info.cursor.length > 0
      ? info.cursor
      : undefined;

    if (info.list_complete || !nextCursor || nextCursor === previousCursor) {
      cursor = undefined;
    } else {
      cursor = nextCursor;
    }
  } while (cursor);

  return keys;
}

async function buildAssetRecords(baseDir: string, files: string[], deployedAt: string) {
  const records: SiteAssetRecord[] = [];
  for (const absolute of files) {
    const buffer = await fs.readFile(absolute);
    const relative = path.relative(baseDir, absolute).replace(/\\/g, '/');
    const contentType = guessMimeType(relative);
    records.push({
      path: relative,
      contentType,
      encoding: 'base64',
      content: toBase64(buffer),
      hash: sha256(buffer),
      size: buffer.byteLength,
      deployedAt,
    });
  }
  return records;
}

export async function publishSite(options: PublishSiteOptions = {}): Promise<PublishSiteResult> {
  const siteDir = ensureSiteDir();
  const exists = await pathExists(siteDir);
  if (!exists) {
    throw new Error(`Site directory not found at ${siteDir}`);
  }

  const files = await readSiteFiles(siteDir);
  if (!files.length) {
    throw new Error('No files found in site/. Nothing to publish.');
  }

  const deployedAt = new Date().toISOString();
  const records = await buildAssetRecords(siteDir, files, deployedAt);
  const creds = getCloudflareCredentials();

  console.log(`📦 Publishing ${records.length} assets to Cloudflare KV...`);

  const existingKeys = await listExistingSiteKeys(creds);
  const writtenKeys = new Set<string>();

  for (const record of records) {
    const key = `${SITE_PREFIX}${record.path}`;
    writtenKeys.add(key);
    const payload = JSON.stringify(record);
    await putKvValue(creds, key, payload, 'application/json');
    console.log(`  • uploaded ${record.path} (${record.size} bytes)`);
  }

  const manifestEntries: PublishSiteResult['manifest']['assets'] = {};
  for (const record of records) {
    manifestEntries[record.path] = {
      hash: record.hash,
      size: record.size,
      contentType: record.contentType,
      deployedAt: record.deployedAt,
    };
  }

  const manifest = {
    generatedAt: deployedAt,
    triggeredBy: options.triggeredBy,
    assetCount: records.length,
    assets: manifestEntries,
  };

  await putKvValue(
    creds,
    `${SITE_PREFIX}manifest`,
    JSON.stringify(manifest, null, 2),
    'application/json',
  );

  const removed: string[] = [];
  for (const key of existingKeys) {
    if (RESERVED_KEYS.has(key)) continue;
    if (!writtenKeys.has(key)) {
      await deleteKvKey(creds, key);
      removed.push(key);
      console.log(`  • removed stale key ${key}`);
    }
  }

  const summary = `🚀 <b>Site deployed</b>\n• Files: <code>${records.length}</code>\n• Removed: <code>${removed.length}</code>\n• Triggered by: <b>${options.triggeredBy || 'manual'}</b>`;
  if (options.notify !== false) {
    await sendTelegramMessage(summary).catch(() => undefined);
    await sendCompletionPing('Website deploy');
  }

  return { manifest, removedKeys: removed };
}

async function runCli() {
  const triggeredBy = process.env.GITHUB_WORKFLOW
    ? `workflow:${process.env.GITHUB_WORKFLOW}`
    : 'manual';
  try {
    const result = await publishSite({ triggeredBy });
    console.log('✅ Publish complete:', JSON.stringify(result.manifest, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('❌ Publish failed:', message);
    await sendTelegramMessage(`❌ <b>Site deploy failed</b>\n<code>${message}</code>`).catch(() => undefined);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ''}`).href) {
  runCli();
}
