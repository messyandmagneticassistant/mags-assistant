import { Buffer } from 'buffer';
import { ensureOrderWorkspace, ensureFolder, loadIconLibrary } from './common';
import type { NormalizedIntake, IconBundleResult, IconAsset, FulfillmentWorkspace } from './types';
import {
  loadAdvancedEsotericConfig,
  resolveCohortFromIntake,
  getActiveSystems,
} from './advanced-esoteric';

interface IconRequest {
  slug: string;
  label: string;
  description: string;
  tags: string[];
  tone: 'bright' | 'soft' | 'earthy';
}

function deriveIconRequests(intake: NormalizedIntake): IconRequest[] {
  const tone = (intake.prefs?.tone || '').toLowerCase();
  const baseTone: IconRequest['tone'] = tone.includes('earth')
    ? 'earthy'
    : tone.includes('bold')
    ? 'bright'
    : 'soft';

  const requests: IconRequest[] = [
    {
      slug: 'sunrise-anchor',
      label: 'Sunrise anchor',
      description: 'Gentle start to welcome the day with breath and intention.',
      tags: ['morning', 'calm'],
      tone: baseTone,
    },
    {
      slug: 'midday-spark',
      label: 'Midday spark',
      description: 'Creative activation icon for the heart of the day.',
      tags: ['midday', 'creative'],
      tone: baseTone,
    },
    {
      slug: 'evening-soften',
      label: 'Evening soften',
      description: 'Wind-down reminder with candlelight energy.',
      tags: ['evening', 'rest'],
      tone: 'soft',
    },
    {
      slug: 'weekly-reset',
      label: 'Weekly reset',
      description: 'Sunday reset / reset altar icon for planning and gratitude.',
      tags: ['weekly', 'reset'],
      tone: 'earthy',
    },
  ];

  if (intake.tier !== 'mini') {
    requests.push({
      slug: 'seasonal-wave',
      label: 'Seasonal wave',
      description: 'Icon to mark monthly or seasonal pulse checks.',
      tags: ['seasonal', 'cycle'],
      tone: baseTone,
    });
  }

  if (intake.tier === 'full') {
    requests.push(
      {
        slug: 'daily-flow',
        label: 'Daily flow',
        description: 'Visual for detailed daily rhythm prompts.',
        tags: ['daily', 'flow'],
        tone: 'bright',
      },
      {
        slug: 'sacred-rest',
        label: 'Sacred rest',
        description: 'Cue for sabbath or full reset days.',
        tags: ['rest', 'sacred'],
        tone: 'soft',
      }
    );
  }

  const prefThemes = (intake.prefs?.themes || intake.prefs?.focus || '').toString().toLowerCase();
  if (prefThemes.includes('kid') || prefThemes.includes('family')) {
    requests.push({
      slug: 'family-circle',
      label: 'Family circle',
      description: 'Icon to signal shared family rhythm moments.',
      tags: ['family', 'connection'],
      tone: 'bright',
    });
  }

  if (intake.expansions?.includes('advanced-esoteric')) {
    const advanced = loadAdvancedEsotericConfig();
    if (advanced) {
      const cohort = resolveCohortFromIntake(intake);
      const activeSystems = getActiveSystems(advanced, { cohort });
      const activeIds = new Set(activeSystems.map((system) => system.id));
      const iconMatches: Array<{ match: string; id: string }> = [
        { match: 'enneagram', id: 'enneagram' },
        { match: 'akashic', id: 'akashic' },
        { match: 'chakra', id: 'chakras' },
        { match: 'soul urge', id: 'soul-urge' },
        { match: 'progressed', id: 'progressed' },
        { match: 'sabian', id: 'sabian' },
        { match: 'i ching', id: 'iching' },
        { match: 'archetype', id: 'archetype' },
      ];
      const used = new Set<string>();
      for (const icon of advanced.magicCodes.icons) {
        const labelLower = icon.label.toLowerCase();
        const mapping = iconMatches.find((entry) => labelLower.includes(entry.match));
        if (!mapping) continue;
        if (!activeIds.has(mapping.id)) continue;
        const slug = `magic-code-${mapping.id}`;
        if (used.has(slug)) continue;
        used.add(slug);
        requests.push({
          slug,
          label: `${icon.label} magic code`,
          description: icon.meaning,
          tags: ['magic', 'code', mapping.id],
          tone: 'bright',
        });
      }
    }
  }

  return requests;
}

interface LibraryMatch {
  slug: string;
  label: string;
  fileId: string;
  tags: string[];
  tone?: string;
  url?: string;
}

function findLibraryMatch(request: IconRequest, library: LibraryMatch[]): LibraryMatch | null {
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

function paletteForTone(tone: IconRequest['tone']) {
  switch (tone) {
    case 'bright':
      return { bg: '#ffd8e5', accent: '#f26d9d', detail: '#8a3ffc' };
    case 'earthy':
      return { bg: '#f4efe6', accent: '#c97b4a', detail: '#4f3b2f' };
    default:
      return { bg: '#e9ecff', accent: '#7c8cff', detail: '#4b5ad1' };
  }
}

function generateSvgIcon(request: IconRequest): string {
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

function buildManifest(intake: NormalizedIntake, icons: IconAsset[]) {
  return {
    generatedAt: new Date().toISOString(),
    email: intake.email,
    tier: intake.tier,
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

  const requests = deriveIconRequests(intake);
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

  const manifest = buildManifest(intake, icons);
  const manifestFile = await drive.files.create({
    requestBody: {
      name: 'manifest.json',
      mimeType: 'application/json',
      parents: [iconFolder.id!],
    },
    media: { mimeType: 'application/json', body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    fields: 'id, webViewLink',
  });

  return {
    bundleFolderId: iconFolder.id!,
    bundleFolderUrl: iconFolder.webViewLink || '',
    manifestId: manifestFile.data.id || '',
    manifestUrl: manifestFile.data.webViewLink || '',
    icons,
  };
}
