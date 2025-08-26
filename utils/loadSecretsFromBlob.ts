import { decode } from 'base64-arraybuffer';
import { Buffer } from 'buffer';

// Optional: Cloudflare fallback values
const CLOUDFLARE_ACCOUNT_ID = '5ff52dc210a86ff34a0dd3664bacb237';
const CLOUDFLARE_NAMESPACE_ID = '1b8cbbc4a2f8426194368cb39baded79';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || 'vMfaaWOMCYy6KHiaH-xy_vkTDxOaSpiznS0aSR0I';

export async function loadSecretsFromBlob(): Promise<void> {
  let blob = process.env.SECRETS_BLOB;

  if (!blob) {
    console.warn('[secrets] No SECRETS_BLOB in env — trying to fetch from Cloudflare KV');

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_NAMESPACE_ID}/values/SECRET_BLOB`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('[secrets] ❌ Could not fetch from Cloudflare KV:', response.statusText);
      return;
    }

    blob = await response.text();
  }

  try {
    const decoded =
      typeof atob !== 'undefined' ? atob(blob) : Buffer.from(blob, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value as string;
      }
    }

    console.info('[secrets] ✅ Secrets loaded from blob');
  } catch (err) {
    console.error('[secrets] ❌ Failed to decode or parse blob:', err);
  }
}