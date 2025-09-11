import fs from 'fs';
import path from 'path';

async function main() {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token) {
    console.error('Missing CF_ACCOUNT_ID or CF_API_TOKEN');
    process.exit(1);
  }

  const brainPath = path.join(process.cwd(), 'docs', 'brain.md');
  const body = await fs.promises.readFile(brainPath, 'utf8');

  const wrangler = await fs.promises.readFile('wrangler.toml', 'utf8');
  const match = wrangler.match(/binding\s*=\s*"BRAIN"[\s\S]*?id\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('BRAIN kv namespace id not found in wrangler.toml');
  }
  const namespaceId = match[1];

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/PostQ:thread-state`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Failed to update brain:', res.status, text);
    process.exit(1);
  }

  console.log('Brain updated');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
