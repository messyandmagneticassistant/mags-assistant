import { Buffer } from 'buffer';
import type { drive_v3 } from 'googleapis';
import { ensureFolder, loadIconLibrary, loadFulfillmentConfig } from './common';
import type { BundleIconDefinition } from './magnet-bundles';
import type { FulfillmentWorkspace } from './types';
import { getDrive } from '../../lib/google';
import { slugify } from '../../utils/slugify';

export type CricutCutSize = 0.75 | 1.25 | 2;

export interface CricutExportBundle {
  id?: string;
  name?: string;
  household?: string;
  icons: BundleIconDefinition[];
}

export interface CricutExportOptions {
  size?: CricutCutSize;
  includeLabels?: boolean;
  /**
   * When true, generate an auxiliary PDF that only contains the labels so users
   * can print translucent overlays or reference sheets.
   */
  createLabelOverlay?: boolean;
  /** Optional override for the household label used in filenames. */
  household?: string;
  /** Optional pre-resolved Drive folder where exports should live. */
  folderId?: string;
  /** Optional injected Drive client (primarily for tests). */
  drive?: drive_v3.Drive;
  /** Optional workspace to reuse during fulfillment runs. */
  workspace?: FulfillmentWorkspace;
  /** Optional environment passthrough for fulfillment config lookups. */
  env?: any;
  /** Optional icon library override (tests/offline). */
  library?: Array<{ slug: string; fileId?: string; name?: string }>;
  /** Optional SVG fetcher override (tests/offline). */
  fetchSvg?: (fileId: string, drive: drive_v3.Drive) => Promise<string | null>;
}

export interface CricutCutFileResult {
  fileId: string;
  fileUrl: string;
  fileName: string;
  size: CricutCutSize;
  includeLabels: boolean;
  iconCount: number;
  labelOverlay?: { fileId: string; fileUrl: string; fileName: string } | null;
}

const DPI = 96; // SVG coordinate space for inches
const GAP_INCHES = 0.125;
const SUPPORTED_SIZES: CricutCutSize[] = [0.75, 1.25, 2];

function isCricutSize(value: number): value is CricutCutSize {
  return SUPPORTED_SIZES.includes(value as CricutCutSize);
}

function normalizeSize(size?: CricutCutSize): CricutCutSize {
  if (size && isCricutSize(size)) return size;
  return 1.25;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

function sanitizeFileSegment(value: string): string {
  return sanitizeLabel(value).replace(/[\\/:*?"<>|]/g, '-');
}

function stripOuterSvg(svg: string): { content: string; width: number; height: number } {
  const withoutXml = svg.replace(/<\?xml[^>]*>/gi, '').trim();
  const openingMatch = withoutXml.match(/<svg[^>]*>/i);
  if (!openingMatch) {
    return { content: withoutXml, width: 512, height: 512 };
  }

  const opening = openingMatch[0];
  const content = withoutXml
    .slice(withoutXml.indexOf(opening) + opening.length)
    .replace(/<\/svg>\s*$/i, '');

  const viewBoxMatch = opening.match(/viewBox="([^"]+)"/i);
  if (viewBoxMatch) {
    const [, raw] = viewBoxMatch;
    const parts = raw
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseFloat(part));
    if (parts.length === 4) {
      return { content, width: parts[2] || 512, height: parts[3] || 512 };
    }
  }

  const widthMatch = opening.match(/width="([^"]+)"/i);
  const heightMatch = opening.match(/height="([^"]+)"/i);
  const width = widthMatch ? Number.parseFloat(widthMatch[1]) : 512;
  const height = heightMatch ? Number.parseFloat(heightMatch[1]) : 512;
  return { content, width: width || 512, height: height || 512 };
}

function renderFallbackFragment(label: string, diameter: number): string {
  const radius = diameter / 2;
  const safeLabel = escapeXml(label.toUpperCase().slice(0, 14));
  const fontSize = Math.max(12, Math.round(diameter / 4));
  return `
    <rect width="${diameter}" height="${diameter}" fill="#f4f4f4" />
    <text x="${radius}" y="${radius}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family="'Poppins', 'Arial', sans-serif" fill="#333">
      ${safeLabel}
    </text>
  `;
}

function prepareFragment(svg: string, diameter: number): string {
  const stripped = stripOuterSvg(svg);
  const scaleBasis = Math.max(stripped.width || 1, stripped.height || 1);
  const scale = diameter / scaleBasis;
  const offsetX = (diameter - stripped.width * scale) / 2;
  const offsetY = (diameter - stripped.height * scale) / 2;
  return `
    <g transform="translate(${offsetX.toFixed(2)} ${offsetY.toFixed(2)}) scale(${scale})">
      ${stripped.content}
    </g>
  `;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function generateLabelOverlayPdf(labels: string[]): Buffer {
  const width = 8.5 * 72;
  const height = 11 * 72;
  const leading = 18;
  const startX = 72;
  const startY = height - 72;
  const textBody = labels
    .map((label, index) => {
      const safe = escapePdf(label);
      const suffix = index === labels.length - 1 ? '' : '\nT*';
      return `(${safe}) Tj${suffix}`;
    })
    .join('\n');

  const stream = `BT\n/F1 16 Tf\n${leading} TL\n${startX} ${startY} Td\n${textBody}\nET`;

  const objects: string[] = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n`,
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  let offset = Buffer.byteLength(pdf, 'utf8');

  for (const object of objects) {
    offsets.push(offset);
    pdf += object;
    offset += Buffer.byteLength(object, 'utf8');
  }

  const xrefOffset = offset;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    const loc = offsets[i];
    pdf += `${loc.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

async function defaultFetchSvg(fileId: string, drive: drive_v3.Drive): Promise<string | null> {
  try {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data as ArrayBuffer);
    const text = buffer.toString('utf8');
    if (/<svg[\s\S]*>/i.test(text)) {
      return text;
    }
  } catch (err) {
    console.warn('[cricut.export] Failed to download SVG asset:', err);
  }
  return null;
}

export async function exportCricutCutFile(
  bundle: CricutExportBundle,
  opts: CricutExportOptions = {}
): Promise<CricutCutFileResult> {
  if (!bundle?.icons?.length) {
    throw new Error('Bundle must include at least one icon to export a Cricut cut file.');
  }

  const includeLabels = opts.includeLabels !== false;
  const size = normalizeSize(opts.size);
  const diameter = size * DPI;
  const gap = GAP_INCHES * DPI;
  const labelHeight = includeLabels ? Math.round(0.35 * DPI) : 0;
  const columns = Math.ceil(Math.sqrt(bundle.icons.length));
  const rows = Math.ceil(bundle.icons.length / columns);
  const width = columns * diameter + (columns - 1) * gap;
  const height = rows * (diameter + labelHeight) + (rows - 1) * gap;

  const drive = opts.drive || opts.workspace?.drive || (await getDrive());
  const fetchSvg = opts.fetchSvg || defaultFetchSvg;

  const libraryEntries = opts.library || (await loadIconLibrary());
  const library = new Map<string, { fileId?: string; name?: string }>();
  for (const entry of libraryEntries) {
    if (entry?.slug) {
      library.set(entry.slug, { fileId: entry.fileId, name: entry.name });
    }
  }

  const clipDefs: string[] = [];
  const groups: string[] = [];
  const labels: string[] = [];

  for (let index = 0; index < bundle.icons.length; index += 1) {
    const icon = bundle.icons[index];
    const slug = icon.slug || slugify(icon.label || `icon-${index + 1}`);
    const libraryMatch = library.get(slug);
    let fragment: string | null = null;
    if (libraryMatch?.fileId) {
      const svg = await fetchSvg(libraryMatch.fileId, drive);
      if (svg) {
        fragment = prepareFragment(svg, diameter);
      }
    }
    if (!fragment) {
      fragment = renderFallbackFragment(icon.label || slug, diameter);
    }

    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = col * (diameter + gap);
    const y = row * (diameter + labelHeight + gap);
    const radius = diameter / 2;
    const clipId = `${bundle.id || 'bundle'}-${slug}-clip-${index}`;
    clipDefs.push(
      `<clipPath id="${clipId}"><circle cx="${radius}" cy="${radius}" r="${radius}" /></clipPath>`
    );

    const cleanLabel = sanitizeLabel(icon.label || libraryMatch?.name || slug);
    labels.push(cleanLabel);

    const textBlock = includeLabels
      ? `<text x="${radius}" y="${diameter + labelHeight - 8}" text-anchor="middle" font-size="${Math.max(
          12,
          Math.round(diameter / 5)
        )}" font-family="'Poppins', 'Arial', sans-serif" fill="#111">${escapeXml(cleanLabel)}</text>`
      : '';

    const group = `
      <g transform="translate(${x} ${y})">
        <circle cx="${radius}" cy="${radius}" r="${radius - 0.5}" fill="none" stroke="#111" stroke-width="1" />
        <g clip-path="url(#${clipId})">
          ${fragment}
        </g>
        ${textBlock}
      </g>
    `;
    groups.push(group);
  }

  const svgDocument = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" data-bundle="${escapeXml(
    bundle.id || slugify(bundle.name || 'bundle')
  )}" data-size="${size}">
  <defs>
    ${clipDefs.join('\n')}
  </defs>
  <g id="cricut-bundle">
    ${groups.join('\n')}
  </g>
</svg>`;

  let folderId = opts.folderId;
  if (!folderId) {
    const workspace = opts.workspace;
    if (workspace?.orderFolderId && workspace?.config?.driveRootId) {
      const root = await ensureFolder(drive, workspace.config.driveRootId, 'CricutExports');
      folderId = root.id!;
    } else {
      const config = await loadFulfillmentConfig({ env: opts.env });
      const root = await ensureFolder(drive, config.driveRootId, 'CricutExports');
      folderId = root.id!;
    }
  }

  const householdSegment = sanitizeFileSegment(
    opts.household || bundle.household || 'Household'
  );
  const bundleSegment = sanitizeFileSegment(bundle.name || bundle.id || 'Bundle');
  const sizeLabel = `${size.toString().replace('.', '-')}in`;
  const fileName = `Cricut–${householdSegment}–${bundleSegment}–${sizeLabel}.svg`;

  const svgFile = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'image/svg+xml',
      parents: [folderId],
    },
    media: { mimeType: 'image/svg+xml', body: Buffer.from(svgDocument, 'utf8') },
    fields: 'id, webViewLink',
  });

  let labelOverlay: CricutCutFileResult['labelOverlay'] = null;
  if (opts.createLabelOverlay && labels.length) {
    const overlayBuffer = generateLabelOverlayPdf(labels);
    const overlayName = `Cricut–${householdSegment}–${bundleSegment}–Labels.pdf`;
    const pdf = await drive.files.create({
      requestBody: {
        name: overlayName,
        mimeType: 'application/pdf',
        parents: [folderId],
      },
      media: { mimeType: 'application/pdf', body: overlayBuffer },
      fields: 'id, webViewLink',
    });
    labelOverlay = {
      fileId: pdf.data.id || '',
      fileUrl: pdf.data.webViewLink || '',
      fileName: overlayName,
    };
  }

  return {
    fileId: svgFile.data.id || '',
    fileUrl: svgFile.data.webViewLink || '',
    fileName,
    size,
    includeLabels,
    iconCount: bundle.icons.length,
    labelOverlay,
  };
}
