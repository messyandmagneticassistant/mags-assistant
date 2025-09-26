import { generateMagnetBundle, findMagnetBundles, type MagnetBundleProfile } from '../../maggie/core/generateMagnetBundle';
import type { Env } from '../lib/env';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function coerceProfile(input: any): MagnetBundleProfile {
  if (input && typeof input === 'object' && (input.profile || input.bundleProfile)) {
    return coerceProfile(input.profile || input.bundleProfile);
  }
  const profile = (input && typeof input === 'object') ? { ...input } : {};
  return profile as MagnetBundleProfile;
}

export async function onRequestGet({ request }: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'bundle') {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  const traitParams = url.searchParams.getAll('trait');
  const trait = traitParams.length ? traitParams : undefined;
  const name = url.searchParams.get('name') || url.searchParams.get('q') || (segments[1] || null);
  const household = url.searchParams.get('household') || undefined;
  const profileId = url.searchParams.get('id') || undefined;
  const hd = url.searchParams.get('hd') || url.searchParams.get('humanDesign');

  const bundles = await findMagnetBundles({
    name: name || undefined,
    household: household || undefined,
    profileId: profileId || undefined,
    humanDesignType: hd || undefined,
    trait,
  });

  return json({ ok: true, bundles, count: bundles.length });
}

export async function onRequestPost({ request }: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'bundle') {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  const body = await request.json().catch(() => ({}));
  const profile = coerceProfile(body.profile ?? body);
  const persist = body.persist ?? false;
  const minIcons = typeof body.minIcons === 'number' ? body.minIcons : undefined;
  const requestedBy = body.requestedBy || 'worker-route';

  const bundle = await generateMagnetBundle(profile, {
    persist,
    minIcons,
    requestedBy,
    driveFolderId: body.driveFolderId,
    sheetId: body.sheetId,
    env: body.env,
  });

  return json({ ok: true, bundle });
}
