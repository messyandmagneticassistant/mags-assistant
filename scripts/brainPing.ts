import fs from 'fs';
import path from 'path';

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const namespaceId =
    process.env.CF_KV_POSTQ_NAMESPACE_ID || process.env.CF_KV_NAMESPACE_ID;
  if (!account || !token || !namespaceId) {
    console.error(
      'Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or CF_KV_NAMESPACE_ID'
    );
    process.exit(1);
  }

  const local = await fs.promises.readFile(path.join('docs', 'brain.md'), 'utf8');

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/PostQ:thread-state`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to fetch brain:', res.status, text);
    process.exit(1);
  }

  const remote = await res.text();
  const matches = remote.trim() === local.trim();
  console.log(JSON.stringify({ matches, remoteBytes: remote.length, localBytes: local.length }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
