// lib/clients/openai.ts

import OpenAI from 'openai';

let cachedClient: OpenAI | null = null;

/**
 * Initialize or return cached OpenAI client
 */
export function getOpenAI(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('❌ Missing OPENAI_API_KEY in environment variables');
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/**
 * Return preferred OpenAI model from env or fallback
 */
export function getPreferredModel(): string {
  const preferred = process.env.PREFERRED_OPENAI_MODEL?.trim();
  const fallback = 'gpt-4o';

  // If set, only allow known supported models
  const allowed = ['gpt-4', 'gpt-4o', 'gpt-5'];
  return allowed.includes(preferred ?? '') ? preferred! : fallback;
}