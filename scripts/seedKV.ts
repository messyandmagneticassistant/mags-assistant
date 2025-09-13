import process from 'node:process';

async function putKV(account: string, token: string, namespaceId: string, key: string, value: string, contentType: string) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: value,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to write ${key}: ${res.status} ${text}`);
  }
}

async function main() {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  const namespaceId = process.env.CF_KV_POSTQ_NAMESPACE_ID;
  const threadState = process.env.THREAD_STATE_JSON;
  const brainDoc = process.env.BRAIN_DOC_MD;

  if (!account || !token || !namespaceId) {
    console.error('Missing CF_ACCOUNT_ID, CF_API_TOKEN, or CF_KV_POSTQ_NAMESPACE_ID');
    process.exit(1);
  }
  if (!threadState || !brainDoc) {
    console.error('Missing THREAD_STATE_JSON or BRAIN_DOC_MD');
    process.exit(1);
  }

  await putKV(account, token, namespaceId, 'thread-state', threadState, 'application/json');
  await putKV(account, token, namespaceId, 'PostQ:thread-state', brainDoc, 'text/markdown');
  console.log('Seeded KV');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

