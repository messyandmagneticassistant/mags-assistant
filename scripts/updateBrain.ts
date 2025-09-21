import { promises as fs } from 'fs';
import path from 'path';

import { putConfig } from '../lib/kv';
import { loadBrainConfig } from '../maggie.config';

interface BrainState extends Record<string, unknown> {
  lastUpdated?: string;
}

function normalizeValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

async function run() {
  const kvPath = path.resolve(process.cwd(), 'config', 'kv-state.json');
  let payload: BrainState;

  try {
    const raw = await fs.readFile(kvPath, 'utf8');
    payload = JSON.parse(raw) as BrainState;
  } catch (err) {
    console.error(`Failed to read or parse ${kvPath}.`);
    console.error(err);
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  payload.lastUpdated = timestamp;

  try {
    await fs.writeFile(kvPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn(`Failed to persist updated timestamp to ${kvPath}.`, err);
  }

  let cloudflareConfig: Record<string, unknown> = {};
  try {
    cloudflareConfig = (await loadBrainConfig()) ?? {};
  } catch (err) {
    console.warn('Unable to load brain config for Cloudflare credentials, falling back to env.', err);
  }

  const accountId =
    normalizeValue(cloudflareConfig.cloudflareAccountId) ||
    normalizeValue(cloudflareConfig.accountId) ||
    normalizeValue(process.env.CLOUDFLARE_ACCOUNT_ID) ||
    normalizeValue(process.env.CF_ACCOUNT_ID) ||
    normalizeValue(process.env.ACCOUNT_ID);
  const apiToken =
    normalizeValue(cloudflareConfig.cloudflareApiToken) ||
    normalizeValue(cloudflareConfig.apiToken) ||
    normalizeValue(process.env.CLOUDFLARE_API_TOKEN) ||
    normalizeValue(process.env.CF_API_TOKEN) ||
    normalizeValue(process.env.API_TOKEN);
  const namespaceId =
    normalizeValue(cloudflareConfig.kvNamespaceId) ||
    normalizeValue(cloudflareConfig.cloudflareKvNamespaceId) ||
    normalizeValue(cloudflareConfig.namespaceId) ||
    normalizeValue(process.env.CF_KV_POSTQ_NAMESPACE_ID) ||
    normalizeValue(process.env.CF_KV_NAMESPACE_ID);

  try {
    await putConfig('PostQ:thread-state', payload, {
      accountId,
      apiToken,
      namespaceId,
      contentType: 'application/json',
    });
    console.log(
      `✅ Synced PostQ:thread-state from config/kv-state.json to Cloudflare KV at ${timestamp}.`
    );
  } catch (err) {
    console.error('❌ Failed to sync Maggie brain config to Cloudflare KV.');
    if (err instanceof Error) {
      console.error(err.message);
      if (err.message.includes('credentials')) {
        console.error(
          'Double-check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CF_KV_POSTQ_NAMESPACE_ID.'
        );
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('❌ Unexpected error while syncing Maggie brain config.');
  console.error(err);
  process.exit(1);
});
