import { Buffer } from 'buffer';
import { ensureOrderWorkspace, ensureFolder, loadIconLibrary } from './common';
import type {
  NormalizedIntake,
  IconBundleResult,
  IconAsset,
  FulfillmentWorkspace,
  IconBundlePdfVariant,
  IconStyleLevel,
  IconAudienceProfile,
} from './types';
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

function paletteForTone(
  tone: MagnetIconRequest['tone'],
  styleLevel?: IconStyleLevel,
  creativeTone?: boolean,
  highContrast?: boolean
) {
  if (highContrast) {
    return { bg: '#ffffff', accent: '#000000', detail: '#000000' };
  }
  if (styleLevel === 'kid_friendly') {
    return { bg: '#ffe6b5', accent: '#ff8a65', detail: '#c25e2c' };
  }
  if (styleLevel === 'neurodivergent_support') {
    return { bg: '#e5f6ff', accent: '#2196f3', detail: '#0d47a1' };
  }
  if (creativeTone) {
    return { bg: '#f3e8ff', accent: '#bb86fc', detail: '#6200ee' };
  }
  switch (tone) {
    case 'bright':
      return { bg: '#ffd8e5', accent: '#f26d9d', detail: '#8a3ffc' };
    case 'earthy':
      return { bg: '#f4efe6', accent: '#c97b4a', detail: '#4f3b2f' };
    default:
      return { bg: '#e9ecff', accent: '#7c8cff', detail: '#4b5ad1' };
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateSvgIcon(request: MagnetIconRequest): string {
  const palette = paletteForTone(request.tone, request.styleLevel, request.creativeTone, request.highContrast);
  const text = request.label.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 20);
  const fontSize =
    request.styleLevel === 'kid_friendly'
      ? 64
      : request.styleLevel === 'elder_accessible'
      ? 60
      : request.styleLevel === 'neurodivergent_support'
      ? 56
      : 48;
  const metadata = escapeXml(
    JSON.stringify({ iconSize: request.iconSize, styleLevel: request.styleLevel, audience: request.audienceName || undefined })
  );
  const categoryText = request.emphasizeCategories && request.category ? request.category.toUpperCase().slice(0, 20) : '';
  const categoryFont = Math.max(fontSize - 16, 30);
  const accentOpacity = request.highContrast ? 0.4 : 0.75;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <metadata>${metadata}</metadata>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg}" />
      <stop offset="100%" stop-color="${palette.accent}" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="64" fill="url(#bg)" />
  <circle cx="256" cy="220" r="140" fill="${palette.accent}" opacity="${accentOpacity}" />
  <path d="M120 360 C180 300 332 300 392 360" stroke="${palette.detail}" stroke-width="22" fill="none" stroke-linecap="round" />
  <text x="256" y="404" font-family="'Poppins', 'Arial', sans-serif" font-size="${fontSize}" fill="${palette.detail}" text-anchor="middle">${escapeXml(
    text
  )}</text>
  ${
    categoryText
      ? `<text x="256" y="460" font-family="'Poppins', 'Arial', sans-serif" font-size="${categoryFont}" fill="${palette.detail}" text-anchor="middle" opacity="0.85">${escapeXml(
          categoryText
        )}</text>`
      : ''
  }
</svg>`;
}

function pdfTextEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdfBuffer(audience: IconAudienceProfile, requests: MagnetIconRequest[]): Buffer {
  const lines: string[] = [];
  lines.push(`${audience.name}'s Magnet Bundle`);
  lines.push(`Style: ${audience.styleLevel.replace(/_/g, ' ')}, icon size ${audience.iconSize}`);
  if (audience.highContrast) lines.push('High contrast text and bold outlines recommended.');
  if (audience.simplifyText) lines.push('Use simplified wording on shared boards.');
  if (audience.needsRepetition) lines.push('Repeat key magnets for regulation cues.');
  lines.push('');
  lines.push('Icons:');
  const iconLines = requests
    .map((req) => `${req.label}${req.iconSize ? ` (${req.iconSize})` : ''}`)
    .slice(0, 12);
  lines.push(...iconLines);

  const textOps: string[] = ['BT', '/F1 24 Tf', '1 0 0 1 72 720 Tm', '28 TL'];
  lines.forEach((line, index) => {
    const escaped = pdfTextEscape(line);
    if (index === 0) {
      textOps.push(`(${escaped}) Tj`);
      textOps.push('/F1 18 Tf');
      textOps.push('22 TL');
    } else {
      textOps.push('T*');
      textOps.push(`(${escaped}) Tj`);
    }
  });
  textOps.push('ET');

  const content = textOps.join('\n');
  const objects: string[] = [''];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
  );
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += objects[i];
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += 'xref\n';
  pdf += `0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < objects.length; i++) {
    pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefStart}\n`;
  pdf += '%%EOF';

  return Buffer.from(pdf, 'utf8');
}

async function createPdfVariants(
  drive: FulfillmentWorkspace['drive'],
  folderId: string,
  plan: MagnetBundlePlan,
  requests: MagnetIconRequest[]
): Promise<IconBundlePdfVariant[]> {
  const variants: IconBundlePdfVariant[] = [];
  const audiences = plan.personalization.audiences?.length
    ? plan.personalization.audiences
    : [
        {
          name: plan.personalization.primaryAudienceName || 'Primary',
          cohort: plan.personalization.cohort || 'adult',
          iconSize: plan.personalization.iconSize,
          styleLevel: plan.personalization.styleLevel,
          simplifyText: plan.personalization.simplifyText,
          highContrast: plan.personalization.highContrast,
          needsRepetition: plan.personalization.needsRepetition,
          emphasizeCategories: plan.personalization.emphasizeCategories,
          creativeTone: plan.personalization.creativeTone,
          version: 1,
        },
      ];

  for (const audience of audiences) {
    try {
      const buffer = buildPdfBuffer(audience, requests);
      const safeName = audience.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'bundle';
      const version = audience.version || 1;
      const fileName = `${safeName.toLowerCase()}-icons-v${version}.pdf`;
      const created = await drive.files.create({
        requestBody: {
          name: fileName,
          mimeType: 'application/pdf',
          parents: [folderId],
        },
        media: { mimeType: 'application/pdf', body: buffer },
        fields: 'id, webViewLink',
      });
      variants.push({
        name: audience.name,
        version,
        fileId: created.data.id || '',
        url: created.data.webViewLink || '',
        iconSize: audience.iconSize,
        styleLevel: audience.styleLevel,
      });
    } catch (err) {
      console.warn('[icon-bundle] failed to create PDF variant:', err);
    }
  }

  return variants;
}

function buildManifest(
  intake: NormalizedIntake,
  icons: IconAsset[],
  plan: MagnetBundlePlan,
  pdfVersions: IconBundlePdfVariant[]
) {
  const requestKey = (req: Pick<MagnetIconRequest, 'slug' | 'label'>) => `${req.slug}:${req.label}`.toLowerCase();
  const requestMap = new Map<string, MagnetIconRequest>();
  for (const req of plan.requests) {
    requestMap.set(requestKey(req), req);
  }

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
      styleLevel: plan.bundle.styleLevel,
      iconSize: plan.bundle.iconSize,
    },
    styleProfile: {
      iconSize: plan.personalization.iconSize,
      styleLevel: plan.personalization.styleLevel,
      simplifyText: plan.personalization.simplifyText,
      highContrast: plan.personalization.highContrast,
      needsRepetition: plan.personalization.needsRepetition,
      emphasizeCategories: plan.personalization.emphasizeCategories,
      audiences: plan.personalization.audiences,
    },
    pdfVersions,
    icons: icons.map((icon) => {
      const key = requestKey({ slug: icon.slug, label: icon.name });
      const meta = requestMap.get(key) || plan.requests.find((req) => req.slug === icon.slug);
      return {
        slug: icon.slug,
        name: icon.name,
        description: icon.description,
        fileId: icon.fileId,
        url: icon.url,
        origin: icon.origin,
        iconSize: icon.iconSize || meta?.iconSize,
        styleLevel: icon.styleLevel || meta?.styleLevel,
        audience: icon.audience || meta?.audienceName,
        highContrast: icon.highContrast ?? meta?.highContrast,
        needsRepetition: icon.needsRepetition ?? false,
        category: meta?.category,
      };
    }),
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
        iconSize: request.iconSize,
        styleLevel: request.styleLevel,
        audience: request.audienceName,
        highContrast: request.highContrast,
        needsRepetition: plan.personalization.needsRepetition,
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
      iconSize: request.iconSize,
      styleLevel: request.styleLevel,
      audience: request.audienceName,
      highContrast: request.highContrast,
      needsRepetition: plan.personalization.needsRepetition,
    });
  }

  const pdfVersions = await createPdfVariants(drive, iconFolder.id!, plan, requests);
  const manifest = buildManifest(intake, icons, plan, pdfVersions);
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
    icons,
    pdfVersions,
  };
}
