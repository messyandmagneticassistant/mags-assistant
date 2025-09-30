type IconDefinition = {
  slug: string;
  label: string;
  description: string;
  tags: string[];
};

type CricutExportBundle = {
  id: string;
  name: string;
  household?: string;
  icons: IconDefinition[];
};

type CricutExportOptions = {
  size?: number;
  includeLabels: boolean;
  createLabelOverlay: boolean;
  household?: string;
  env: any;
};

type CricutExportResult = {
  url?: string;
  [key: string]: any;
};

function parseSize(input: any): number | undefined {
  const raw = typeof input === 'string' ? Number.parseFloat(input) : input;
  if (raw === 0.75 || raw === 1.25 || raw === 2) {
    return raw;
  }
  return undefined;
}

function buildNormalizeIcons(slugify: (value: string) => string) {
  return function normalizeIcons(icons: any[] = []): IconDefinition[] {
    return icons
      .filter(Boolean)
      .map((icon, index) => {
        const label = icon?.label || icon?.name || `Icon ${index + 1}`;
        return {
          slug: icon?.slug || slugify(label),
          label,
          description: icon?.description || '',
          tags: Array.isArray(icon?.tags) ? icon.tags : [],
        } satisfies IconDefinition;
      });
  };
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const profile = (body.profile ?? {}) as Record<string, any>;
  const incomingBundle = (body.bundle ?? {}) as Record<string, any>;

  // @ts-ignore - shared helpers come from the application bundle
  const { slugify } = await import('../../utils/' + 'slugify');
  const normalizeIcons = buildNormalizeIcons(slugify as (value: string) => string);

  const icons = normalizeIcons((incomingBundle.icons ?? body.icons ?? profile.icons ?? []) as any[]);
  if (!icons.length) {
    return new Response(JSON.stringify({ ok: false, error: 'No icons supplied for Cricut export.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const bundle: CricutExportBundle = {
    id: incomingBundle.id || slugify((incomingBundle.name || profile.bundleName || 'cricut-bundle') as string),
    name: incomingBundle.name || profile.bundleName || 'Custom Cricut Bundle',
    household: incomingBundle.household || body.household || profile.household || profile.householdName,
    icons,
  };

  const requestedSize =
    parseSize(body.size) || parseSize(body.cricutSize) || parseSize(body.magnetSize) || parseSize(incomingBundle.size);

  try {
    // @ts-ignore - export helper is shared with the Node runtime
    const { exportCricutCutFile } = await import('../../src/' + 'fulfillment/cricut');
    const result: CricutExportResult = await exportCricutCutFile(bundle, {
      size: requestedSize,
      includeLabels: body.includeLabels !== false,
      createLabelOverlay: body.labelOverlay === true || body.overlay === 'pdf',
      household: body.household || profile.household || profile.householdName,
      env,
    } satisfies CricutExportOptions);

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
