// lib/clients/notion.ts

import { Client } from '@notionhq/client';
import { getConfig } from '../../utils/config';

let cachedNotion: Client | null = null;

/**
 * Initialize or return cached Notion client using config blob
 */
export async function getNotionClient(): Promise<Client> {
  if (cachedNotion) return cachedNotion;

  const { token } = await getConfig('notion'); // pull from secrets blob or KV
  if (!token) {
    throw new Error('❌ Missing Notion token in config for "notion"');
  }

  cachedNotion = new Client({ auth: token });
  return cachedNotion;
}