import { updateBrain } from './lib/brain';
import { getConfig } from './utils/config';
import { watch, appendFileSync } from 'fs';
import { runMaggieWorkflow } from './runMaggie';

export const HOSTNAME = "https://assistant.messyandmagnetic.com";
export const CF_ROUTE = "https://assistant.messyandmagnetic.com/*";
export const CF_ACCOUNT_ID = "5ff52dc210a86ff34a0dd3664bacb237";
export const CF_ZONE_ID = "2cfbda5c5f45871836cfcf15285f5f13";
export const CF_KV_NAMESPACE = "POSTQ";

// Founder + identity metadata
export const FOUNDER_FULL_NAME = "Chanel Christine Marraccini";
export const SIGNATURE_PERMISSION_GRANTED = true;
export const PRIMARY_EMAIL_IDENTITY = {
  name: "Maggie from Messy & Magnetic™",
  email: "maggie@messyandmagnetic.com",
};

export async function loadBrainConfig() {
  try {
    return await getConfig('brain');
  } catch (err) {
    console.warn('failed to load brain config', err);
    const {
      WORKER_URL,
      WORKER_KEY,
      CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_KV_NAMESPACE_ID
    } = process.env;

    if (
      WORKER_URL &&
      WORKER_KEY &&
      CLOUDFLARE_ACCOUNT_ID &&
      CLOUDFLARE_API_TOKEN &&
      CLOUDFLARE_KV_NAMESPACE_ID
    ) {
      return {
        workerUrl: WORKER_URL,
        workerKey: WORKER_KEY,
        cloudflareAccountId: CLOUDFLARE_ACCOUNT_ID,
        cloudflareApiToken: CLOUDFLARE_API_TOKEN,
        kvNamespaceId: CLOUDFLARE_KV_NAMESPACE_ID
      };
    }

    throw new Error(
      'Missing brain config. Set WORKER_URL, WORKER_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_KV_NAMESPACE_ID.'
    );
  }
}

// Sync the brain config to Cloudflare after each deploy.
export async function postDeploy() {
  try {
    await updateBrain({ message: 'Deployed brain configuration sync', tiers: 'Full' });
  } catch (err) {
    console.warn('postDeploy brain sync failed', err);
  }
}

// Allow manual brain updates to trigger the same sync logic.
export async function manualBrainUpdate(message: string) {
  try {
    await updateBrain({ message, tiers: 'Lite' });
  } catch (err) {
    console.warn('manualBrainUpdate failed', err);
  }
}

// Watch local brain file and log to posted.log when changes occur
export function watchBrainFile() {
  try {
    watch('.brain.md', async () => {
      try {
        await updateBrain({ message: 'Local brain file changed', tiers: 'Mini' }, 'watcher');
        await runMaggieWorkflow();
        appendFileSync('posted.log', `${new Date().toISOString()} brain file synced\n`);
      } catch (err) {
        console.warn('watchBrainFile sync failed', err);
      }
    });
  } catch (err) {
    console.warn('File watch not available', err);
  }
}
