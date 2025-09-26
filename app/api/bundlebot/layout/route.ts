import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { generateAndUploadPDF, type RhythmStyle } from '../../../../bundlebot/generateAndUploadPDF';
import { slugify } from '../../../../utils/slugify';
import type {
  MagnetIconRequest,
  BlankMagnetPlaceholder,
  BundleBotLayoutRequest,
  BundleBotFeedbackRequest,
} from '../../../../src/fulfillment/magnet-bundles';

export const runtime = 'nodejs';

type LayoutFormat = BundleBotLayoutRequest['format'] | 'magnet-kit';

interface LayoutPayload {
  placeholders?: Array<
    Partial<MagnetIconRequest & { emoji?: string }> | Partial<BlankMagnetPlaceholder & { emoji?: string }>
  >;
  layoutRequest?: Partial<BundleBotLayoutRequest> & { format?: LayoutFormat };
  feedbackRequest?: Partial<BundleBotFeedbackRequest>;
  helperNotes?: string | null;
  name?: string;
  theme?: string;
  style?: RhythmStyle;
  qrCodeUrl?: string;
}

interface NormalizedIcon {
  slug: string;
  label: string;
  description?: string;
  emoji?: string;
}

interface LayoutResponse {
  imageURL: string;
  layoutSVG: string;
  iconGrid: string[];
  pdfPath?: string;
  driveLink?: string;
}

const CELL_WIDTH = 160;
const CELL_HEIGHT = 160;
const CELL_GAP = 24;
const MAX_LABEL_LENGTH = 32;

export async function POST(request: NextRequest) {
  let payload: LayoutPayload;

  try {
    payload = (await request.json()) as LayoutPayload;
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const icons = normalizePlaceholders(payload.placeholders);

  if (!icons.length) {
    return NextResponse.json(
      {
        imageURL: '',
        layoutSVG: '',
        iconGrid: [],
        error: 'No placeholders were provided to generate a layout.',
      },
      { status: 400 },
    );
  }

  const forcedFormat = normalizeFormat(request.nextUrl.searchParams.get('format'));
  const layoutFormat = forcedFormat ?? payload.layoutRequest?.format;
  const columns = resolveColumnCount(layoutFormat);

  const grid = chunkIcons(icons, columns);
  const iconGrid = grid.map((row) => row.map((icon) => icon.label).join(' • '));

  const title = resolveTitle(payload, icons);
  const imageURL = buildPreviewImageURL(title, grid.length, columns);
  const layoutSVG = buildLayoutSVG({
    title,
    icons: grid,
    helperNotes: payload.helperNotes,
  });

  const response: LayoutResponse = {
    imageURL,
    layoutSVG,
    iconGrid,
  };

  if (layoutSVG && payload?.name) {
    try {
      const layoutImagePath = await saveLayoutPreview(layoutSVG, payload.name);
      const pdfResult = await generateAndUploadPDF({
        name: payload.name,
        theme: payload.theme || 'custom',
        style: normalizeStyle(payload.style),
        layoutImagePath,
        qrCodeUrl: payload.qrCodeUrl || payload.feedbackRequest?.link,
      });
      response.pdfPath = pdfResult.filePath;
      response.driveLink = pdfResult.driveLink;
    } catch (error) {
      console.error('[bundlebot.layout] failed to generate printable PDF:', error);
    }
  }

  return NextResponse.json(response);
}

function normalizePlaceholders(
  placeholders: LayoutPayload['placeholders'],
): NormalizedIcon[] {
  if (!Array.isArray(placeholders)) return [];

  return placeholders
    .map((placeholder, index) => {
      if (!placeholder || typeof placeholder !== 'object') return null;

      const slug = readString(placeholder, ['slug', 'id']) || `placeholder-${index + 1}`;
      const label = readString(placeholder, ['label', 'name']) || `Magnet ${index + 1}`;
      const description = readString(placeholder, ['description']);
      const emoji = readString(placeholder, ['emoji', 'icon']);

      return { slug, label, description, emoji } satisfies NormalizedIcon;
    })
    .filter((icon): icon is NormalizedIcon => Boolean(icon));
}

function readString(source: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function resolveColumnCount(format: LayoutFormat | undefined): number {
  if (format === 'magnet-kit') return 3;
  return 4;
}

function normalizeFormat(value: string | null | undefined): LayoutFormat | undefined {
  if (value === 'pdf' || value === 'svg' || value === 'magnet-kit') {
    return value;
  }
  return undefined;
}

function chunkIcons(icons: NormalizedIcon[], columns: number): NormalizedIcon[][] {
  const rows: NormalizedIcon[][] = [];
  icons.forEach((icon, index) => {
    const rowIndex = Math.floor(index / columns);
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex]!.push(icon);
  });
  return rows;
}

function resolveTitle(payload: LayoutPayload, icons: NormalizedIcon[]): string {
  const headline = payload.feedbackRequest?.headline;
  if (headline && headline.trim()) return headline.trim();

  const instruction = payload.layoutRequest?.instructions;
  if (instruction && instruction.trim()) {
    const condensed = instruction.trim().split(/\n|\.\s+/)[0]!;
    if (condensed.length <= MAX_LABEL_LENGTH) return condensed;
    return `${condensed.slice(0, MAX_LABEL_LENGTH - 1)}…`;
  }

  if (icons.length) {
    const sample = icons.slice(0, 3).map((icon) => icon.label).join(' • ');
    if (sample) return sample;
  }

  return 'Magnet Layout Preview';
}

function buildPreviewImageURL(title: string, rows: number, columns: number): string {
  const width = columns * (CELL_WIDTH + CELL_GAP) + CELL_GAP;
  const height = rows * (CELL_HEIGHT + CELL_GAP) + CELL_GAP + 80;
  const background = 'f7f4ef';
  const foreground = '2f2a28';
  return `https://placehold.co/${Math.max(width, 200)}x${Math.max(height, 200)}/${background}/${foreground}?text=${encodeURIComponent(
    title,
  )}`;
}

function buildLayoutSVG({
  title,
  icons,
  helperNotes,
}: {
  title: string;
  icons: NormalizedIcon[][];
  helperNotes?: string | null;
}): string {
  const rows = icons.length;
  const columns = Math.max(0, ...icons.map((row) => row.length));
  const effectiveColumns = Math.max(columns, 1);
  const width = effectiveColumns * (CELL_WIDTH + CELL_GAP) + CELL_GAP;
  const height = rows * (CELL_HEIGHT + CELL_GAP) + CELL_GAP + 120;

  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  svgParts.push('<style>text{font-family:\'Inter\',sans-serif;} .label{font-size:18px;font-weight:600;fill:#2f2a28;} .desc{font-size:14px;fill:#5b524d;} .title{font-size:28px;font-weight:700;fill:#2f2a28;} .notes{font-size:14px;fill:#5b524d;}</style>');
  svgParts.push(`<rect width="100%" height="100%" fill="#fdfaf5" rx="24" />`);

  svgParts.push(`<text class="title" x="${CELL_GAP}" y="${CELL_GAP + 28}">${escapeXML(title)}</text>`);

  icons.forEach((row, rowIndex) => {
    row.forEach((icon, columnIndex) => {
      const x = CELL_GAP + columnIndex * (CELL_WIDTH + CELL_GAP);
      const y = CELL_GAP + 48 + rowIndex * (CELL_HEIGHT + CELL_GAP);
      svgParts.push(`<rect x="${x}" y="${y}" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" rx="20" fill="#fff" stroke="#e1d9d2" stroke-width="2" />`);
      if (icon.emoji) {
        svgParts.push(`<text x="${x + CELL_WIDTH / 2}" y="${y + 56}" font-size="42" text-anchor="middle">${escapeXML(icon.emoji)}</text>`);
      }
      svgParts.push(
        `<text class="label" x="${x + 20}" y="${y + (icon.emoji ? 96 : 60)}">${escapeXML(truncate(icon.label, MAX_LABEL_LENGTH))}</text>`,
      );
      if (icon.description) {
        svgParts.push(
          `<text class="desc" x="${x + 20}" y="${y + (icon.emoji ? 126 : 90)}">${escapeXML(truncate(icon.description, MAX_LABEL_LENGTH + 12))}</text>`,
        );
      }
    });
  });

  if (helperNotes && helperNotes.trim()) {
    const y = CELL_GAP + 48 + rows * (CELL_HEIGHT + CELL_GAP) + 28;
    svgParts.push(`<text class="notes" x="${CELL_GAP}" y="${y}">${escapeXML(helperNotes.trim())}</text>`);
  }

  svgParts.push('</svg>');
  return svgParts.join('');
}

function escapeXML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function normalizeStyle(value: unknown): RhythmStyle {
  if (value === 'child' || value === 'adult' || value === 'elder') {
    return value;
  }
  return 'adult';
}

async function saveLayoutPreview(svg: string, name: string): Promise<string> {
  const safeName = sanitizeFileSegment(name);
  const fileName = `${safeName}-layout-${Date.now()}.png`;
  const filePath = path.join('/tmp', fileName);
  await fs.mkdir('/tmp', { recursive: true });
  await sharp(Buffer.from(svg, 'utf8'), { density: 320 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(filePath);
  return filePath;
}

function sanitizeFileSegment(value: string): string {
  const slug = slugify(value || '').replace(/[^a-z0-9_-]/gi, '');
  return slug || 'layout';
}
