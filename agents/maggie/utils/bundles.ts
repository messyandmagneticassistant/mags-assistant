import type { MagnetBundlePlan } from '../../../src/fulfillment/magnet-bundles';

export interface BundleLayoutResult {
  imageURL?: string;
  layoutSVG?: string;
  iconGrid?: string[];
}

const EMPTY_LAYOUT: BundleLayoutResult = {
  imageURL: '',
  layoutSVG: '',
  iconGrid: [],
};

function resolveEndpoint(plan: MagnetBundlePlan): string {
  let endpoint = (process.env.BUNDLEBOT_LAYOUT_URL || '').trim();

  if (!endpoint) {
    const base = (process.env.BUNDLEBOT_SERVICE_URL || '').trim();
    if (base) {
      endpoint = `${base.replace(/\/$/, '')}/layout`;
    }
  }

  if (!endpoint) {
    const hasWindow = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined';
    endpoint = hasWindow ? '/api/bundlebot/layout' : 'https://bundlebot.messyandmagnetic.com/layout';
  }

  const format = (plan.layoutRequest as any)?.format;
  if (format === 'magnet-kit') {
    const join = endpoint.includes('?') ? '&' : '?';
    endpoint = `${endpoint}${join}format=magnet-kit`;
  }

  return endpoint;
}

export async function spawnBundleBot(plan: MagnetBundlePlan): Promise<BundleLayoutResult> {
  const placeholders = (plan as unknown as { placeholders?: unknown }).placeholders ?? plan.requests ?? [];
  const payload = {
    placeholders,
    layoutRequest: plan.layoutRequest,
    feedbackRequest: plan.feedbackRequest,
    helperNotes: plan.helperNotes,
  };

  const endpoint = resolveEndpoint(plan);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`BundleBot layout request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as BundleLayoutResult | null;
    if (!data || typeof data !== 'object') {
      throw new Error('BundleBot layout response malformed.');
    }

    const iconGrid = Array.isArray(data.iconGrid) ? data.iconGrid.filter((item) => typeof item === 'string') : [];

    // TODO: Update the associated Notion page with layout results once available.

    return {
      imageURL: typeof data.imageURL === 'string' ? data.imageURL : '',
      layoutSVG: typeof data.layoutSVG === 'string' ? data.layoutSVG : '',
      iconGrid,
    };
  } catch (error) {
    console.error('[spawnBundleBot] Failed to generate bundle layout:', error);
    return { ...EMPTY_LAYOUT };
  }
}
