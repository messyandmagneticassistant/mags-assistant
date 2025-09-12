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

  const brainPath = path.join(process.cwd(), 'docs', 'brain.md');
  const body = await fs.promises.readFile(brainPath, 'utf8');

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
