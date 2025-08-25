// utils/loadSecretsFromBlob.ts
import { Buffer } from 'buffer';

export function loadSecretsFromBlob() {
  const blob = process.env.SECRETS_BLOB;
  if (!blob) {
    console.warn('[secrets] No SECRETS_BLOB found in process.env');
    return;
  }

  try {
    const decoded = Buffer.from(blob, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value as string;
      }
    }

    console.info('[secrets] Loaded secrets from SECRETS_BLOB ✅');
  } catch (err) {
    console.error('[secrets] Failed to load SECRETS_BLOB:', err);
  }
}