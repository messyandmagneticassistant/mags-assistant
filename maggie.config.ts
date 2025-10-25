import { updateBrain } from './lib/brain';
import { getConfig } from './utils/config';
import { watch, appendFileSync } from 'fs';

// ========== DEPLOY + CLOUD INFRA ==========
export const HOSTNAME = "https://assistant.messyandmagnetic.com";
export const CF_ROUTE = "https://assistant.messyandmagnetic.com/*";
export const CF_ACCOUNT_ID = "5ff52dc210a86ff34a0dd3664bacb237";
export const CF_ZONE_ID = "2cfbda5c5f45871836cfcf15285f5f13";
export const CF_KV_NAMESPACE = "POSTQ";

// ========== OWNER INFO ==========
export const FOUNDER_FULL_NAME = "Chanel Christine Marraccini";
export const SIGNATURE_PERMISSION_GRANTED = true;
export const PRIMARY_EMAIL_IDENTITY = {
  name: "Maggie from Messy & Magnetic™",
  email: "maggie@messyandmagnetic.com",
};

// ========== CORE TASK STRUCTURE ==========
export const Maggie = {
  name: "Maggie",
  role: "Full-stack assistant running business ops, social media, soul delivery, and donor outreach",
  brain: "config:brain",
  tasks: ["soulDelivery", "donorHunt", "socialGrowth", "quizProcessing", "errorMonitor"],
  schedule: ["@hourly"],

  telegram: {
    enabled: true,
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  stripe: {
    enabled: true,
    secretKey: process.env.STRIPE_SECRET_KEY,
  },

  notion: {
    enabled: true,
    apiKey: process.env.NOTION_API_KEY,
    databaseId: process.env.NOTION_DB_ID,
  },

  gmail: {
    enabled: true,
    sender: process.env.GMAIL_SENDER,
    replyTo: "hello@messyandmagnetic.com",
  },

  sheets: {
    enabled: true,
    sheetId: process.env.GOOGLE_SHEET_ID,
  },
};

// ========== DEPLOYMENT BRAIN SYNC ==========
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

export async function postDeploy() {
  try {
    await updateBrain({ message: 'Deployed brain configuration sync', tiers: 'Full' });
  } catch (err) {
    console.warn('postDeploy brain sync failed', err);
  }
}

export async function manualBrainUpdate(message: string) {
  try {
    await updateBrain({ message, tiers: 'Lite' });
  } catch (err) {
    console.warn('manualBrainUpdate failed', err);
  }
}

export function watchBrainFile() {
  try {
    watch('brain/brain.json', async () => {
      try {
        await updateBrain({ message: 'Local brain file changed', tiers: 'Mini' }, 'watcher');
        const { runMaggieWorkflow } = await import('./runMaggie');
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