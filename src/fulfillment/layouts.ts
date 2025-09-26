import PDFDocument from 'pdfkit';
import type { PDFDocument as PDFDocumentType } from 'pdfkit';
import { Resvg } from '@resvg/resvg-js';
import type { drive_v3 } from 'googleapis';
import { ensureFolder } from './common';
import type { FulfillmentConfig } from './types';

export interface BundleLayoutIcon {
  label: string;
  tags?: string[];
  slug?: string;
}

export interface BundleLayoutInput {
  bundleName: string;
  category?: string;
  householdName?: string;
  icons: BundleLayoutIcon[];
}

export interface BundleLayoutResult {
  pdfId: string;
  pdfUrl: string;
  svgId: string;
  svgUrl: string;
  pngId?: string;
  pngUrl?: string;
  folderId: string;
  folderUrl: string;
  fileBaseName: string;
  pageCount: number;
}

interface LayoutOptions {
  drive: drive_v3.Drive;
  config: FulfillmentConfig;
  timestamp?: Date;
}

interface GroupedIcons {
  title?: string;
  icons: BundleLayoutIcon[];
}

const LETTER_WIDTH = 612; // 8.5in at 72dpi
const LETTER_HEIGHT = 792; // 11in at 72dpi
const MAX_COLUMNS = 5;
const MAX_ROWS = 6;
const CELL_MARGIN = 8;
const HEADER_MARGIN = 32;
const HOUSEHOLD_FOLDER_MAX = 80;

function sanitizeFilenameSegment(input: string, fallback = 'Bundle'): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[\n\r]+/g, ' ')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHouseholdName(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function resolveGroupTitle(icon: BundleLayoutIcon): string | undefined {
  const tags = icon.tags || [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const match = tag.match(/^(?:group|section|category)[:=](.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function groupIcons(icons: BundleLayoutIcon[]): GroupedIcons[] {
  const groups: GroupedIcons[] = [];
  for (const icon of icons) {
    const title = resolveGroupTitle(icon);
    if (!title) {
      if (!groups.length || groups[groups.length - 1].title) {
        groups.push({ title: undefined, icons: [icon] });
      } else {
        groups[groups.length - 1].icons.push(icon);
      }
      continue;
    }

    const last = groups[groups.length - 1];
    if (last && last.title === title) {
      last.icons.push(icon);
    } else {
      groups.push({ title, icons: [icon] });
    }
  }
  return groups.length ? groups : [{ icons }];
}

interface LayoutCell {
  icon: BundleLayoutIcon;
  groupTitle?: string;
  isFirstInGroup: boolean;
}

function flattenGroups(groups: GroupedIcons[]): LayoutCell[] {
  const cells: LayoutCell[] = [];
  for (const group of groups) {
    group.icons.forEach((icon, index) => {
      cells.push({
        icon,
        groupTitle: group.title,
        isFirstInGroup: index === 0 && Boolean(group.title),
      });
    });
  }
  return cells;
}

function renderPdfPage(
  doc: PDFDocumentType,
  options: {
    householdLabel: string;
    bundleName: string;
    category?: string;
    pageNumber: number;
    totalPages: number;
  }
) {
  const { householdLabel, bundleName, category, pageNumber, totalPages } = options;
  const headerLines = [
    `${householdLabel} — ${bundleName}`,
    category ? `Category: ${category}` : undefined,
    `Page ${pageNumber + 1} of ${totalPages}`,
  ].filter(Boolean) as string[];

  doc.fillColor('#1f1f1f');
  doc.fontSize(16).font('Helvetica-Bold');
  doc.text(headerLines[0] || '', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(11).font('Helvetica');
  for (let i = 1; i < headerLines.length; i += 1) {
    doc.text(headerLines[i]!, { align: 'left' });
  }
  doc.moveDown(0.5);
}

function drawPdfCells(
  doc: PDFDocumentType,
  cells: LayoutCell[],
  pageIndex: number,
  totalPages: number,
  header: {
  householdLabel: string;
  bundleName: string;
  category?: string;
}) {
  renderPdfPage(doc, {
    householdLabel: header.householdLabel,
    bundleName: header.bundleName,
    category: header.category,
    pageNumber: pageIndex,
    totalPages,
  });

  const usableWidth = LETTER_WIDTH - HEADER_MARGIN * 2;
  const usableHeight = LETTER_HEIGHT - HEADER_MARGIN * 2 - 72; // leave room for footer
  const cellWidth = usableWidth / MAX_COLUMNS;
  const cellHeight = usableHeight / MAX_ROWS;
  const startX = HEADER_MARGIN;
  let currentY = doc.y;

  const cellsForPage = cells.slice(pageIndex * MAX_COLUMNS * MAX_ROWS, (pageIndex + 1) * MAX_COLUMNS * MAX_ROWS);

  cellsForPage.forEach((cell, index) => {
    const column = index % MAX_COLUMNS;
    const row = Math.floor(index / MAX_COLUMNS);
    const x = startX + column * cellWidth + CELL_MARGIN / 2;
    const y = currentY + row * cellHeight + CELL_MARGIN / 2;
    const width = cellWidth - CELL_MARGIN;
    const height = cellHeight - CELL_MARGIN;

    doc.roundedRect(x, y, width, height, 10).lineWidth(1.2).stroke('#c8d0f0');

    const padding = 12;
    let textY = y + padding;
    if (cell.isFirstInGroup && cell.groupTitle) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#5d6ad5');
      doc.text(cell.groupTitle, x + padding, textY, { width: width - padding * 2, align: 'center' });
      textY += 16;
    }

    doc.font('Helvetica').fontSize(12).fillColor('#222222');
    doc.text(cell.icon.label, x + padding, textY, {
      width: width - padding * 2,
      align: 'center',
    });
  });
}

function createPdfBuffer(cells: LayoutCell[], header: {
  householdLabel: string;
  bundleName: string;
  category?: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: HEADER_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const totalPages = Math.max(1, Math.ceil(cells.length / (MAX_COLUMNS * MAX_ROWS)));
    for (let page = 0; page < totalPages; page += 1) {
      if (page > 0) doc.addPage();
      drawPdfCells(doc, cells, page, totalPages, header);
    }

    doc.end();
  });
}

function createSvg(cells: LayoutCell[], header: {
  householdLabel: string;
  bundleName: string;
  category?: string;
}): { svg: string; pageCount: number } {
  const totalPages = Math.max(1, Math.ceil(cells.length / (MAX_COLUMNS * MAX_ROWS)));
  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LETTER_WIDTH}" height="${LETTER_HEIGHT * totalPages}" viewBox="0 0 ${LETTER_WIDTH} ${LETTER_HEIGHT * totalPages}" font-family="'Helvetica','Arial',sans-serif">`
  );

  for (let page = 0; page < totalPages; page += 1) {
    const offsetY = page * LETTER_HEIGHT;
    const headerY = HEADER_MARGIN;
    const title = `${header.householdLabel} — ${header.bundleName}`;
    svgParts.push(
      `<g transform="translate(0, ${offsetY})">\n` +
        `  <text x="${HEADER_MARGIN}" y="${headerY}" font-size="16" font-weight="700" fill="#1f1f1f">${escapeXml(
          title
        )}</text>\n`
    );
    let extraY = headerY + 18;
    if (header.category) {
      svgParts.push(
        `  <text x="${HEADER_MARGIN}" y="${extraY}" font-size="11" fill="#2c2c2c">${escapeXml(
          `Category: ${header.category}`
        )}</text>\n`
      );
      extraY += 14;
    }
    svgParts.push(
      `  <text x="${HEADER_MARGIN}" y="${extraY}" font-size="11" fill="#2c2c2c">${escapeXml(
        `Page ${page + 1} of ${totalPages}`
      )}</text>`
    );

    const usableWidth = LETTER_WIDTH - HEADER_MARGIN * 2;
    const usableHeight = LETTER_HEIGHT - HEADER_MARGIN * 2 - 72;
    const cellWidth = usableWidth / MAX_COLUMNS;
    const cellHeight = usableHeight / MAX_ROWS;
    const startX = HEADER_MARGIN;
    const startY = extraY + 12;

    const cellsForPage = cells.slice(page * MAX_COLUMNS * MAX_ROWS, (page + 1) * MAX_COLUMNS * MAX_ROWS);

    cellsForPage.forEach((cell, index) => {
      const column = index % MAX_COLUMNS;
      const row = Math.floor(index / MAX_COLUMNS);
      const x = startX + column * cellWidth + CELL_MARGIN / 2;
      const y = startY + row * cellHeight + CELL_MARGIN / 2;
      const width = cellWidth - CELL_MARGIN;
      const height = cellHeight - CELL_MARGIN;
      svgParts.push(`  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" ry="10" fill="none" stroke="#c8d0f0" stroke-width="1.2" />`);
      const padding = 12;
      let textY = y + padding + 4;
      if (cell.isFirstInGroup && cell.groupTitle) {
        svgParts.push(
          `  <text x="${x + width / 2}" y="${textY}" font-size="10" font-weight="700" fill="#5d6ad5" text-anchor="middle">${escapeXml(
            cell.groupTitle
          )}</text>`
        );
        textY += 16;
      }
      svgParts.push(
        `  <text x="${x + width / 2}" y="${textY}" font-size="12" fill="#222222" text-anchor="middle">${escapeXml(
          cell.icon.label
        )}</text>`
      );
    });

    svgParts.push('</g>');
  }

  svgParts.push('</svg>');
  return { svg: svgParts.join('\n'), pageCount: totalPages };
}

function escapeXml(value: string): string {
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
        return '&apos;';
      default:
        return char;
    }
  });
}

async function createPngFromSvg(svg: string): Promise<Buffer | null> {
  try {
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: 'width',
        value: Math.round((LETTER_WIDTH / 72) * 300),
      },
    });
    const rendered = resvg.render();
    return Buffer.from(rendered.asPng());
  } catch (err) {
    console.warn('[layouts] failed to render PNG fallback:', err);
    return null;
  }
}

function buildFileBaseName(household: string, bundleName: string, timestamp: Date): string {
  const safeHousehold = sanitizeFilenameSegment(household, 'Household').replace(/\s+/g, '_');
  const safeBundle = sanitizeFilenameSegment(bundleName, 'Bundle').replace(/\s+/g, '_');
  const yyyy = timestamp.getFullYear();
  const mm = String(timestamp.getMonth() + 1).padStart(2, '0');
  const dd = String(timestamp.getDate()).padStart(2, '0');
  return `${safeHousehold}–${safeBundle}–${yyyy}${mm}${dd}`;
}

function trimFolderName(name: string): string {
  if (name.length <= HOUSEHOLD_FOLDER_MAX) return name;
  return name.slice(0, HOUSEHOLD_FOLDER_MAX);
}

export async function generateBundleLayout(
  input: BundleLayoutInput,
  options: LayoutOptions
): Promise<BundleLayoutResult> {
  const timestamp = options.timestamp || new Date();
  const householdName = normalizeHouseholdName(input.householdName) || input.bundleName || 'Household';
  const householdLabel = sanitizeFilenameSegment(householdName, 'Household');
  const groups = groupIcons(input.icons);
  const cells = flattenGroups(groups);

  const header = {
    householdLabel,
    bundleName: input.bundleName,
    category: input.category,
  };

  const pdfBuffer = await createPdfBuffer(cells, header);
  const { svg, pageCount } = createSvg(cells, header);
  const pngBuffer = await createPngFromSvg(svg);

  const drive = options.drive;
  const kitsRoot = await ensureFolder(drive, options.config.driveRootId, 'Printable Kits');
  const householdFolder = await ensureFolder(
    drive,
    kitsRoot.id!,
    trimFolderName(householdLabel || 'Household')
  );

  const baseName = buildFileBaseName(householdLabel, input.bundleName, timestamp);

  const pdf = await drive.files.create({
    requestBody: {
      name: `${baseName}.pdf`,
      mimeType: 'application/pdf',
      parents: [householdFolder.id!],
    },
    media: { mimeType: 'application/pdf', body: pdfBuffer },
    fields: 'id, webViewLink',
  });

  const svgFile = await drive.files.create({
    requestBody: {
      name: `${baseName}.svg`,
      mimeType: 'image/svg+xml',
      parents: [householdFolder.id!],
    },
    media: { mimeType: 'image/svg+xml', body: Buffer.from(svg, 'utf8') },
    fields: 'id, webViewLink',
  });

  let pngResult: drive_v3.Schema$File | null = null;
  if (pngBuffer) {
    pngResult = await drive.files
      .create({
        requestBody: {
          name: `${baseName}.png`,
          mimeType: 'image/png',
          parents: [householdFolder.id!],
        },
        media: { mimeType: 'image/png', body: pngBuffer },
        fields: 'id, webViewLink',
      })
      .catch((err) => {
        console.warn('[layouts] failed to persist PNG fallback:', err);
        return null;
      });
  }

  return {
    pdfId: pdf.data.id || '',
    pdfUrl: pdf.data.webViewLink || '',
    svgId: svgFile.data.id || '',
    svgUrl: svgFile.data.webViewLink || '',
    pngId: pngResult?.id || undefined,
    pngUrl: pngResult?.webViewLink || undefined,
    folderId: householdFolder.id!,
    folderUrl: householdFolder.webViewLink || '',
    fileBaseName: baseName,
    pageCount,
  };
}

