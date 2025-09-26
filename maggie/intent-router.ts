// maggie/intent-router.ts

import { tgSend } from '../lib/telegram';
import { runMaggie } from './index';
import { buildMaggieStatusMessage } from './status';
import {
  listBundlesForOwner,
  findBundleByName,
  cloneBundleLibraryEntry,
  formatBundleSummary,
} from '../src/fulfillment/bundle-library';

function normalizeQuotes(input: string): string {
  return input.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function extractQuotedValues(input: string): string[] {
  const normalized = normalizeQuotes(input);
  const matches = Array.from(normalized.matchAll(/"([^"]+)"/g)).map((match) => match[1].trim());
  if (matches.length) return matches.filter(Boolean);
  return Array.from(normalized.matchAll(/'([^']+)'/g)).map((match) => match[1].trim()).filter(Boolean);
}

function sanitizeOwnerQuery(value: string): string {
  return value.replace(/bundle[s]?/gi, '').trim();
}

async function handleShowBundles(raw: string) {
  const normalized = normalizeQuotes(raw);
  const match = normalized.match(/^\/show\s+bundles\s+for\s+(.+)$/i);
  if (!match) return false;
  const owner = sanitizeOwnerQuery(match[1]);
  if (!owner) {
    await tgSend('⚠️ Please specify whose bundles to show, e.g. /show bundles for Eden.');
    return true;
  }

  const rows = await listBundlesForOwner(owner);
  if (!rows.length) {
    await tgSend(`ℹ️ No saved bundles found for ${owner}.`);
    return true;
  }

  const limit = 5;
  const preview = rows.slice(0, limit).map((row) => formatBundleSummary(row));
  const header = `📚 <b>Bundles for ${owner}</b>`;
  const suffix = rows.length > limit ? `\n\n… and ${rows.length - limit} more in the library.` : '';
  await tgSend([header, ...preview].join('\n\n') + suffix);
  return true;
}

async function handleReuseBundle(raw: string) {
  const normalized = normalizeQuotes(raw);
  if (!/^\/reuse\b/i.test(normalized)) return false;
  const quoted = extractQuotedValues(normalized);
  let bundleName = quoted[0];
  if (!bundleName) {
    const stripped = normalized.replace(/^\/reuse\s+/i, '').replace(/bundle$/i, '').trim();
    bundleName = stripped;
  }
  if (!bundleName) {
    await tgSend('⚠️ Please include the bundle name to reuse, e.g. /reuse "Morning Reset" bundle.');
    return true;
  }

  const bundle = await findBundleByName(bundleName);
  if (!bundle) {
    await tgSend(`ℹ️ Could not find a bundle named ${bundleName}.`);
    return true;
  }

  await tgSend(`♻️ Reuse ready:\n${formatBundleSummary(bundle)}`);
  return true;
}

async function handleCloneBundle(raw: string) {
  const normalized = normalizeQuotes(raw);
  if (!/^\/clone\b/i.test(normalized)) return false;
  const quoted = extractQuotedValues(normalized);
  let original = quoted[0];
  let renamed = quoted[1];

  if ((!original || !renamed) && /\bas\b/i.test(normalized)) {
    const match = normalized.match(/^\/clone\s+(?:and\s+rename\s+)?(.+?)\s+as\s+(.+)$/i);
    if (match) {
      original = original || match[1].trim();
      renamed = renamed || match[2].trim();
    }
  }

  if (!original || !renamed) {
    await tgSend('⚠️ Please provide the original and new bundle names, e.g. /clone and rename "Memphis Week" as "Memphis October".');
    return true;
  }

  const cloned = await cloneBundleLibraryEntry(original, renamed);
  if (!cloned) {
    await tgSend(`ℹ️ Could not clone ${original} — make sure it exists in the library.`);
    return true;
  }

  await tgSend(`🆕 Cloned bundle ready:\n${formatBundleSummary(cloned)}`);
  return true;
}

export async function dispatch(message: string, options: { source: string }) {
  const raw = message.trim();
  const text = raw.toLowerCase();

  if (await handleShowBundles(raw)) return 'Listed bundles.';
  if (await handleReuseBundle(raw)) return 'Bundle reuse requested.';
  if (await handleCloneBundle(raw)) return 'Bundle clone requested.';

  if (text === '/help') {
    const helpText = `
🧠 <b>Maggie Help Menu</b>

Commands you can try:
  /status — Show system status
  /maggie-status — Detailed task + queue summary
  /run — Force Maggie to run now
  /help — Show this menu
    `.trim();
    await tgSend(helpText);
    return 'Sent help menu.';
  }

  if (text === '/status' || text === '/maggie-status') {
    const statusMessage = await buildMaggieStatusMessage();
    await tgSend(statusMessage);
    return 'Reported status.';
  }

  if (text === '/run') {
    await tgSend('⚙️ Running Maggie now...');
    await runMaggie({ force: true, source: 'telegram' });
    return 'Triggered Maggie run.';
  }

  await tgSend("🤖 Unknown command. Try /help.");
  return 'Unknown command.';
}