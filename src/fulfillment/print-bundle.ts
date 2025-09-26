import { getDrive } from '../../lib/google';
import { loadFulfillmentConfig } from './common';
import { generateBundleLayout, type BundleLayoutInput, type BundleLayoutIcon } from './layouts';
import type { BundleLayoutResult } from './types';
import { findBundleByName, type StoredMagnetBundle } from './magnet-bundles';

export interface PrintBundlePayload {
  bundleName?: string;
  household?: string;
  icons?: Array<string | { label: string; tags?: string[] }>;
  category?: string;
}

export interface PrintBundleResult {
  ok: true;
  layout: BundleLayoutResult;
  bundleName: string;
  category?: string;
  household?: string;
}

function normalizeIcons(source: NonNullable<PrintBundlePayload['icons']>): BundleLayoutIcon[] {
  return source
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const label = entry.trim();
        if (!label) return null;
        return { label } satisfies BundleLayoutIcon;
      }
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) return null;
      return { label, tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : undefined };
    })
    .filter((icon): icon is BundleLayoutIcon => Boolean(icon));
}

function resolveHouseholdName(payload: PrintBundlePayload, fallback: string): string {
  const raw = (payload.household || '').trim();
  if (raw) return raw;
  return fallback;
}

async function resolveBundleFromStore(name: string): Promise<StoredMagnetBundle | null> {
  try {
    return await findBundleByName(name);
  } catch (err) {
    console.warn('[print-bundle] unable to load bundle from store:', err);
    return null;
  }
}

export async function printBundle(payload: PrintBundlePayload, env?: any): Promise<PrintBundleResult> {
  const config = await loadFulfillmentConfig({ env });
  const drive = await getDrive();
  let bundleName = (payload.bundleName || '').trim();
  let category = payload.category?.trim();
  let icons: BundleLayoutIcon[] = [];

  if (Array.isArray(payload.icons) && payload.icons.length) {
    icons = normalizeIcons(payload.icons);
    if (!bundleName) {
      bundleName = 'Custom Magnet Bundle';
    }
  } else if (bundleName) {
    const stored = await resolveBundleFromStore(bundleName);
    if (!stored) {
      throw new Error(`Bundle "${bundleName}" not found`);
    }
    bundleName = stored.name;
    category = category || stored.category;
    icons = stored.icons.map((icon) => ({ label: icon.label, tags: icon.tags, slug: icon.slug }));
  } else {
    throw new Error('bundleName or icons must be provided');
  }

  if (!icons.length) {
    throw new Error('No icons available to print');
  }

  const household = resolveHouseholdName(payload, bundleName);
  const layoutInput: BundleLayoutInput = {
    bundleName,
    category,
    householdName: household,
    icons,
  };

  const layout = await generateBundleLayout(layoutInput, { drive, config, timestamp: new Date() });
  return { ok: true, layout, bundleName, category, household };
}

