import { env } from './env.js';
import { appendRows } from './google.js';

// Simple structured logger writing to console and optional Google Sheet
export async function log(source, message, metadata = {}) {
  const ts = new Date().toISOString();
  const entry = { ts, source, message, ...metadata };
  try {
    console.log(`[${ts}] ${source}: ${message}`, metadata);
    if (env.MASTER_MEMORY_SHEET_ID) {
      const row = [ts, source, message, JSON.stringify(metadata)];
      await appendRows(env.MASTER_MEMORY_SHEET_ID, 'Logs!A:D', [row]);
    }
  } catch (err) {
    console.error('logger error', err);
  }
  return entry;
}
