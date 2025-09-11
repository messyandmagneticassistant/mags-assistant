import fs from 'fs';
import path from 'path';

async function main() {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    console.error('Missing CF_ACCOUNT_ID or CF_API_TOKEN');
    process.exit(1);
  }

  const wrangler = await fs.promises.readFile('wrangler.toml', 'utf8');
  const match = wrangler.match(/binding\s*=\s*"BRAIN"[\s\S]*?id\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('BRAIN kv namespace id not found in wrangler.toml');
  }
  const namespaceId = match[1];

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
