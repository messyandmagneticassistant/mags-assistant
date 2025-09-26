import { Buffer } from 'buffer';
import { ensureOrderWorkspace, ensureFolder, loadIconLibrary } from './common';
import type { NormalizedIntake, IconBundleResult, IconAsset, FulfillmentWorkspace } from './types';
import {
  resolveMagnetBundlePlan,
  persistBundlePlanArtifacts,
  buildFallbackIconRequests,
  type MagnetIconRequest,
  type MagnetBundlePlan,
} from './magnet-bundles';

interface LibraryMatch {
  slug: string;
  label: string;
  fileId: string;
  tags: string[];
  tone?: string;
  url?: string;
}

function findLibraryMatch(request: MagnetIconRequest, library: LibraryMatch[]): LibraryMatch | null {
  const slugMatch = library.find((icon) => icon.slug === request.slug);
  if (slugMatch) return slugMatch;
  const tagMatch = library.find((icon) => {
    if (!icon.tags?.length) return false;
    const normalized = icon.tags.map((t) => t.toLowerCase());
    return request.tags.every((tag) => normalized.includes(tag));
  });
  if (tagMatch) return tagMatch;
  const looseMatch = library.find((icon) => (icon.label || '').toLowerCase().includes(request.label.split(' ')[0].toLowerCase()));
  return looseMatch || null;
}

function paletteForTone(tone: MagnetIconRequest['tone']) {
  switch (tone) {
    case 'bright':
      return { bg: '#ffd8e5', accent: '#f26d9d', detail: '#8a3ffc' };
    case 'earthy':
      return { bg: '#f4efe6', accent: '#c97b4a', detail: '#4f3b2f' };
    default:
      return { bg: '#e9ecff', accent: '#7c8cff', detail: '#4b5ad1' };
  }
}

function generateSvgIcon(request: MagnetIconRequest): string {
  const palette = paletteForTone(request.tone);
  const text = request.label.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 18);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg}" />
      <stop offset="100%" stop-color="${palette.accent}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="64" fill="url(#bg)" />
  <circle cx="256" cy="220" r="140" fill="${palette.accent}" opacity="0.75" />
  <path d="M120 360 C180 300 332 300 392 360" stroke="${palette.detail}" stroke-width="22" fill="none" stroke-linecap="round" />
  <text x="256" y="410" font-family="'Poppins', 'Arial', sans-serif" font-size="46" fill="${palette.detail}" text-anchor="middle">
    ${text}
  </text>
</svg>`;
}

function buildManifest(
  intake: NormalizedIntake,
  icons: IconAsset[],
  plan: MagnetBundlePlan
) {
  return {
    generatedAt: new Date().toISOString(),
    email: intake.email,
    tier: intake.tier,
    bundle: {
      id: plan.bundle.id,
      name: plan.bundle.name,
      category: plan.bundle.category,
      source: plan.source,
      personalization: plan.personalization,
      helperBots: plan.helpers,
      keywords: plan.keywords,
      format: plan.format,
      layoutRequest: plan.layoutRequest,
      feedbackRequest: plan.feedbackRequest,
      helperNotes: plan.helperNotes,
    },
    icons: icons.map((icon) => ({
      slug: icon.slug,
      name: icon.name,
      description: icon.description,
      fileId: icon.fileId,
      url: icon.url,
      origin: icon.origin,
    })),
  };
}

export async function buildIconBundle(
  intake: NormalizedIntake,
  opts: { workspace?: FulfillmentWorkspace; env?: any } = {}
): Promise<IconBundleResult> {
  const workspace = opts.workspace || (await ensureOrderWorkspace(intake, opts));
  const drive = workspace.drive;
  const iconFolder = await ensureFolder(drive, workspace.orderFolderId, 'icons');
  const libraryEntries = await loadIconLibrary();
  const library: LibraryMatch[] = libraryEntries.map((entry) => ({
    slug: entry.slug,
    label: entry.name,
    fileId: entry.fileId,
    tags: entry.tags || [],
    tone: entry.tone,
    url: entry.folderUrl,
  }));

  const plan = await resolveMagnetBundlePlan(intake, { workspace });
  const requests = plan.requests.length ? plan.requests : buildFallbackIconRequests(intake);
  const icons: IconAsset[] = [];

  for (const request of requests) {
    const match = findLibraryMatch(request, library);
    if (match?.fileId) {
      const copy = await drive.files.copy({
        fileId: match.fileId,
        requestBody: {
          name: `${request.label}.png`,
          parents: [iconFolder.id!],
        },
        fields: 'id, webViewLink',
      });
      icons.push({
        slug: request.slug,
        name: request.label,
        description: request.description,
        url: copy.data.webViewLink || match.url || '',
        fileId: copy.data.id || '',
        origin: 'library',
      });
      continue;
    }

    const svg = generateSvgIcon(request);
    const created = await drive.files.create({
      requestBody: {
        name: `${request.label}.svg`,
        mimeType: 'image/svg+xml',
        parents: [iconFolder.id!],
      },
      media: { mimeType: 'image/svg+xml', body: Buffer.from(svg, 'utf8') },
      fields: 'id, webViewLink',
    });
    icons.push({
      slug: request.slug,
      name: request.label,
      description: request.description,
      url: created.data.webViewLink || '',
      fileId: created.data.id || '',
      origin: 'generated',
    });
  }

  const manifest = buildManifest(intake, icons, plan);
  const manifestFile = await drive.files.create({
    requestBody: {
      name: 'manifest.json',
      mimeType: 'application/json',
      parents: [iconFolder.id!],
    },
    media: { mimeType: 'application/json', body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    fields: 'id, webViewLink',
  });

  await persistBundlePlanArtifacts(
    plan,
    icons.map((icon) => ({ fileId: icon.fileId, origin: icon.origin })),
    manifest,
    workspace
  );

  return {
    bundleFolderId: iconFolder.id!,
    bundleFolderUrl: iconFolder.webViewLink || '',
    manifestId: manifestFile.data.id || '',
    manifestUrl: manifestFile.data.webViewLink || '',
    bundleId: plan.bundle.id,
    bundleName: plan.bundle.name,
    bundleCategory: plan.bundle.category,
    bundleSource: plan.source,
    helperBots: plan.helpers,
    keywords: plan.keywords,
    layoutRequest: plan.layoutRequest,
    feedbackRequest: plan.feedbackRequest,
    helperNotes: plan.helperNotes,
    icons,
  };
}
