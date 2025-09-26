import { slugify } from '../../utils/slugify';
import {
  exportCricutCutFile,
  type CricutExportBundle,
  type CricutCutSize,
} from '../../src/fulfillment/cricut';

function normalizeIcons(icons: any[] = []): CricutExportBundle['icons'] {
  return icons
    .filter(Boolean)
    .map((icon, index) => {
      const label = icon.label || icon.name || `Icon ${index + 1}`;
      return {
        slug: icon.slug || slugify(label),
        label,
        description: icon.description || '',
        tags: Array.isArray(icon.tags) ? icon.tags : [],
      };
    });
}

function parseSize(input: any): CricutCutSize | undefined {
  const raw = typeof input === 'string' ? Number.parseFloat(input) : input;
  if (raw === 0.75 || raw === 1.25 || raw === 2) {
    return raw as CricutCutSize;
  }
  return undefined;
}

export async function onRequestPost({ request, env }: any) {
  const body = await request.json().catch(() => ({}));
  const profile = body.profile || {};
  const incomingBundle = body.bundle || {};
  const icons = normalizeIcons(incomingBundle.icons || body.icons || profile.icons || []);

  if (!icons.length) {
    return new Response(JSON.stringify({ ok: false, error: 'No icons supplied for Cricut export.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bundle: CricutExportBundle = {
    id: incomingBundle.id || slugify(incomingBundle.name || profile.bundleName || 'cricut-bundle'),
    name: incomingBundle.name || profile.bundleName || 'Custom Cricut Bundle',
    household: incomingBundle.household || body.household || profile.household || profile.householdName,
    icons,
  };

  const requestedSize =
    parseSize(body.size) || parseSize(body.cricutSize) || parseSize(body.magnetSize) || parseSize(incomingBundle.size);

  try {
    const result = await exportCricutCutFile(bundle, {
      size: requestedSize,
      includeLabels: body.includeLabels !== false,
      createLabelOverlay: body.labelOverlay === true || body.overlay === 'pdf',
      household: body.household || profile.household || profile.householdName,
      env,
    });

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[worker.cricut] export failed', err);
    return new Response(JSON.stringify({ ok: false, error: 'Failed to export Cricut bundle.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
