// runMaggie.ts (root level)

import { loadSecretsFromBlob } from './src/utils/loadSecretsFromBlob';
import { startMaggie } from './src/maggie'; // or update this path if your main logic is elsewhere

// Load secrets from Cloudflare KV (SECRETS_BLOB)
await loadSecretsFromBlob();

// Start Maggie’s main loop or agent logic
await startMaggie();