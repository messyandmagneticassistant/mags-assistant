import fs from 'fs';
import path from 'path';

function getEnv(name: string): string | undefined {
  return process.env[name];
}

async function main() {
  const account =
    getEnv('CLOUDFLARE_ACCOUNT_ID') ||
    getEnv('CF_ACCOUNT_ID') ||
    getEnv('ACCOUNT_ID');
  const token =
    getEnv('CLOUDFLARE_API_TOKEN') ||
    getEnv('CF_API_TOKEN') ||
    getEnv('API_TOKEN');
  const namespaceId =
    process.env.CF_KV_POSTQ_NAMESPACE_ID || process.env.CF_KV_NAMESPACE_ID;
  if (!account || !token || !namespaceId) {
    console.error(
      'Missing CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID, CLOUDFLARE_API_TOKEN/CF_API_TOKEN, or CF_KV_NAMESPACE_ID'
    );
    process.exit(1);
  }

  const kvPath = path.join(process.cwd(), 'config', 'kv-state.json');
  let body: string;
  try {
    const raw = await fs.promises.readFile(kvPath, 'utf8');
    body = JSON.stringify(JSON.parse(raw));
  } catch (err) {
    console.error(`Failed to read or parse ${kvPath}:`, err);
    process.exit(1);
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/thread-state`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to update brain:', res.status, text);
    process.exit(1);
  }

  console.log(
    `Brain updated: thread-state → namespace ${namespaceId} (account ${account})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
