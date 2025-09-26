import { promises as fs } from 'node:fs';
import { exec as cpExec } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { promisify } from 'node:util';
import { sendTelegramMessage } from './lib/telegramClient';

const SITE_PREFIX = 'site:';
const RESERVED_KEYS = new Set([`${SITE_PREFIX}manifest`]);
const exec = promisify(cpExec);

const DEFAULT_BUILD_COMMAND = 'pnpm --filter assistant-ui build';
const FALLBACK_HTML_PATH = path.resolve('public', 'index.html');
const FALLBACK_SOURCE_LABEL = 'public/index.html';
const FALLBACK_COPY_PATH = 'fallback/index.html';
const BUILD_DIR_CANDIDATES = ['ui/dist', 'landing/dist', 'landing', 'site'];

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
    fallbackDeployed?: boolean;
    fallbackSource?: string;
  };
  removedKeys: string[];
}

function normalizePathInput(candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
}

function resolveBuildCommand(): string | null {
  const raw = process.env.SITE_BUILD_COMMAND;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (['skip', 'false', '0', 'no', 'none'].includes(lowered)) {
      return null;
    }
    return trimmed;
  }
  return DEFAULT_BUILD_COMMAND;
}

async function runSiteBuild(): Promise<void> {
  const command = resolveBuildCommand();
  if (!command) {
    console.log('[publishSite] build step skipped (no command provided).');
    return;
  }

  console.log(`[publishSite] running build command: ${command}`);
  const { stdout, stderr } = await exec(command, { cwd: process.cwd(), env: process.env });
  if (stdout?.trim()) {
    console.log(stdout.trim());
  }
  if (stderr?.trim()) {
    console.error(stderr.trim());
  }
}

async function resolveSiteDir(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.SITE_BUILD_DIR) {
    candidates.push(process.env.SITE_BUILD_DIR);
  }
  candidates.push(...BUILD_DIR_CANDIDATES);

  for (const candidate of candidates) {
    const absolute = normalizePathInput(candidate);
    if (!(await pathExists(absolute))) continue;
    const indexCandidates = ['index.html', 'index.htm'];
    for (const index of indexCandidates) {
      if (await pathExists(path.join(absolute, index))) {
        return absolute;
      }
    }
    try {
      const files = await readSiteFiles(absolute);
      if (files.length) {
        return absolute;
      }
    } catch (err) {
      console.warn('[publishSite] failed to read candidate dir', absolute, err);
    }
  }

  return null;
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

function dedupeRecords(records: SiteAssetRecord[]): SiteAssetRecord[] {
  const map = new Map<string, SiteAssetRecord>();
  for (const record of records) {
    map.set(record.path, record);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function buildFallbackRecord(deployedAt: string, pathName: string): Promise<SiteAssetRecord> {
  if (!(await pathExists(FALLBACK_HTML_PATH))) {
    throw new Error(`Fallback HTML missing at ${FALLBACK_HTML_PATH}`);
  }
  const buffer = await fs.readFile(FALLBACK_HTML_PATH);
  return {
    path: pathName,
    contentType: 'text/html; charset=utf-8',
    encoding: 'base64',
    content: toBase64(buffer),
    hash: sha256(buffer),
    size: buffer.byteLength,
    deployedAt,
  } satisfies SiteAssetRecord;
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
  const deployedAt = new Date().toISOString();
  const records: SiteAssetRecord[] = [];
  let siteDir: string | null = null;
  let usedFallbackOnly = false;

  try {
    await runSiteBuild();
  } catch (err) {
    console.warn('[publishSite] build command failed, will try fallback:', err);
  }

  try {
    siteDir = await resolveSiteDir();
    if (siteDir) {
      console.log(`[publishSite] Using build output from ${siteDir}`);
      const files = await readSiteFiles(siteDir);
      if (files.length) {
        const builtRecords = await buildAssetRecords(siteDir, files, deployedAt);
        records.push(...builtRecords);
        const hasFallbackCopy = builtRecords.some((record) => record.path === FALLBACK_COPY_PATH);
        if (!hasFallbackCopy) {
          try {
            const fallbackCopy = await buildFallbackRecord(deployedAt, FALLBACK_COPY_PATH);
            records.push(fallbackCopy);
          } catch (err) {
            console.warn('[publishSite] fallback copy could not be prepared:', err);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[publishSite] failed to gather build output:', err);
  }

  if (!records.length) {
    usedFallbackOnly = true;
    console.warn('[publishSite] No compiled site assets found. Deploying fallback landing page.');
    records.push(await buildFallbackRecord(deployedAt, 'index.html'));
  }

  const assets = dedupeRecords(records);
  if (!assets.length) {
    throw new Error('No site assets available to deploy (build + fallback both failed).');
  }

  const creds = getCloudflareCredentials();
  console.log(`📦 Publishing ${assets.length} assets to Cloudflare KV...`);

  const existingKeys = await listExistingSiteKeys(creds);
  const writtenKeys = new Set<string>();

  for (const record of assets) {
    const key = `${SITE_PREFIX}${record.path}`;
    writtenKeys.add(key);
    const payload = JSON.stringify(record);
    await putKvValue(creds, key, payload, 'application/json');
    console.log(`  • uploaded ${record.path} (${record.size} bytes)`);
  }

  const manifestEntries: PublishSiteResult['manifest']['assets'] = {};
  for (const record of assets) {
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
    assetCount: assets.length,
    assets: manifestEntries,
    fallbackDeployed: usedFallbackOnly,
    fallbackSource: usedFallbackOnly ? FALLBACK_SOURCE_LABEL : undefined,
  } satisfies PublishSiteResult['manifest'];

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

  const modeLine = usedFallbackOnly
    ? `• Mode: <b>fallback</b> (${FALLBACK_SOURCE_LABEL})`
    : '• Mode: <b>build</b> with fallback copy';
  const summary = [
    '🚀 <b>Site deployed</b>',
    `• Files: <code>${assets.length}</code>`,
    `• Removed: <code>${removed.length}</code>`,
    modeLine,
    `• Triggered by: <b>${options.triggeredBy || 'manual'}</b>`,
  ].join('\n');
  if (options.notify !== false) {
    await sendTelegramMessage(summary).catch(() => undefined);
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
