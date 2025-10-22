import fs from 'fs';
import path from 'path';

type BrainState = {
  lastUpdated?: string;
  lastSynced?: string | null;
  [key: string]: unknown;
};

function safeParse(json: string): BrainState | null {
  try {
    return JSON.parse(json) as BrainState;
  } catch (err) {
    console.warn('[brainPing] Unable to parse remote payload as JSON:', err);
    return null;
  }
}

function diffMinutes(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const aTs = Date.parse(a);
  const bTs = Date.parse(b);
  if (Number.isNaN(aTs) || Number.isNaN(bTs)) return null;
  return Math.round((aTs - bTs) / 60000);
}

async function readLocalState(): Promise<{ raw: string; data: BrainState | null }> {
  const filePath = path.join('config', 'kv-state.json');
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return { raw, data: safeParse(raw) };
  } catch (err) {
    console.error(`[brainPing] Failed to read ${filePath}:`, err);
    return { raw: '', data: null };
  }
}

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token =
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CLOUDFLARE_TOKEN ||
    process.env.CF_API_TOKEN ||
    process.env.API_TOKEN;
  const namespaceId =
    process.env.CF_KV_POSTQ_NAMESPACE_ID || process.env.CF_KV_NAMESPACE_ID;
  if (!account || !token || !namespaceId) {
    console.error(
      'Missing Cloudflare credentials. Ensure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (or CLOUDFLARE_TOKEN), and CF_KV_NAMESPACE_ID are set.'
    );
    process.exit(1);
  }

  const { raw: localRaw, data: localState } = await readLocalState();

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/PostQ:thread-state`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to fetch brain:', res.status, text);
    process.exit(1);
  }

  const remoteRaw = await res.text();
  const remoteState = safeParse(remoteRaw);

  const matches = remoteState && localState
    ? JSON.stringify(remoteState) === JSON.stringify(localState)
    : remoteRaw.trim() === localRaw.trim();

  const localUpdated = localState?.lastUpdated || null;
  const remoteUpdated = remoteState?.lastUpdated || null;
  const skewMinutes = diffMinutes(remoteUpdated ?? undefined, localUpdated ?? undefined);

  const result = {
    ok: true,
    matches,
    checkedAt: new Date().toISOString(),
    remoteBytes: remoteRaw.length,
    localBytes: localRaw.length,
    localLastUpdated: localUpdated,
    remoteLastUpdated: remoteUpdated,
    remoteLastSynced: remoteState?.lastSynced ?? null,
    lastUpdatedSkewMinutes: skewMinutes,
  };

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
