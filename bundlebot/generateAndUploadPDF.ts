import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';
import type { drive_v3 } from 'googleapis';

import { getDrive } from '../lib/google';
import { ensureFolder } from '../src/fulfillment/common';
import { slugify } from '../utils/slugify';

export type RhythmStyle = 'child' | 'adult' | 'elder';

export interface GenerateAndUploadPDFOptions {
  name: string;
  theme: string;
  style: RhythmStyle;
  layoutImagePath: string;
  qrCodeUrl?: string;
}

export interface GenerateAndUploadPDFResult {
  status: 'success';
  name: string;
  filePath: string;
  driveLink: string;
}

interface Palette {
  background: [number, number, number];
  heading: [number, number, number];
  subtitle: [number, number, number];
  accent: [number, number, number];
  text: [number, number, number];
}

const STYLE_PRESETS: Record<RhythmStyle, { subtitle: string; palette: Palette; titleSize: number; subtitleSize: number }> = {
  child: {
    subtitle: 'Playful Daily Rhythm',
    titleSize: 26,
    subtitleSize: 16,
    palette: {
      background: hexToRgb('#FFF6EC'),
      heading: hexToRgb('#42342A'),
      subtitle: hexToRgb('#5E4636'),
      accent: hexToRgb('#FF9F6E'),
      text: hexToRgb('#4A3C2F'),
    },
  },
  adult: {
    subtitle: 'Signature Rhythm Routine',
    titleSize: 28,
    subtitleSize: 15,
    palette: {
      background: hexToRgb('#F7F3EE'),
      heading: hexToRgb('#2F2A28'),
      subtitle: hexToRgb('#5B524D'),
      accent: hexToRgb('#7C6CF3'),
      text: hexToRgb('#433B37'),
    },
  },
  elder: {
    subtitle: 'Gentle Flow Companion',
    titleSize: 26,
    subtitleSize: 15,
    palette: {
      background: hexToRgb('#F3F6FA'),
      heading: hexToRgb('#27323F'),
      subtitle: hexToRgb('#4C5968'),
      accent: hexToRgb('#3E9AD6'),
      text: hexToRgb('#35404B'),
    },
  },
};

const THEME_OVERRIDES: Array<{
  test: (theme: string) => boolean;
  overrides: Partial<Palette> & { accent?: [number, number, number]; background?: [number, number, number] };
}> = [
  {
    test: (theme) => /blue|indigo/i.test(theme),
    overrides: { accent: hexToRgb('#5C7AEA'), background: hexToRgb('#F1F4FF') },
  },
  {
    test: (theme) => /sage|green|forest|fern/i.test(theme),
    overrides: { accent: hexToRgb('#6BA88B'), background: hexToRgb('#F2F8F4') },
  },
  {
    test: (theme) => /sun|gold|amber|honey/i.test(theme),
    overrides: { accent: hexToRgb('#F4AE4B'), background: hexToRgb('#FFF5E5') },
  },
  {
    test: (theme) => /rose|pink|blush|peach/i.test(theme),
    overrides: { accent: hexToRgb('#FF8FAB'), background: hexToRgb('#FFF2F6') },
  },
  {
    test: (theme) => /charcoal|slate|midnight/i.test(theme),
    overrides: { accent: hexToRgb('#6C7A89'), background: hexToRgb('#F1F2F4') },
  },
];

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => char + char)
        .join('')
    : normalized;
  const num = parseInt(value, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return [r / 255, g / 255, b / 255];
}

function resolvePalette(theme: string, style: RhythmStyle): Palette {
  const base = { ...STYLE_PRESETS[style].palette };
  const normalizedTheme = theme?.trim() || '';

  for (const entry of THEME_OVERRIDES) {
    if (entry.test(normalizedTheme)) {
      Object.assign(base, entry.overrides);
      break;
    }
  }

  return base;
}

function sanitizeFileSegment(value: string): string {
  const fallback = 'kit';
  if (!value) return fallback;
  const slug = slugify(value).replace(/[^a-z0-9_-]/gi, '');
  return slug || fallback;
}

async function ensureDrivePath(
  drive: drive_v3.Drive,
  segments: string[],
): Promise<drive_v3.Schema$File> {
  let parentId = 'root';
  let current: drive_v3.Schema$File | undefined;
  for (const segment of segments) {
    current = await ensureFolder(drive, parentId, segment);
    parentId = current.id!;
  }
  return current!;
}

async function fetchQrImage(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`QR code fetch failed: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('png')) {
      return await pdf.embedPng(buffer);
    }
    if (contentType.includes('jpg') || contentType.includes('jpeg')) {
      return await pdf.embedJpg(buffer);
    }
    try {
      return await pdf.embedPng(buffer);
    } catch (pngErr) {
      console.warn('[generateAndUploadPDF] PNG embed failed, retrying as JPEG:', pngErr);
      return await pdf.embedJpg(buffer);
    }
  } catch (error) {
    console.warn('[generateAndUploadPDF] Unable to load QR code image:', error);
    return null;
  }
}

export async function generateAndUploadPDF(
  options: GenerateAndUploadPDFOptions,
): Promise<GenerateAndUploadPDFResult> {
  const { name, theme, style, layoutImagePath, qrCodeUrl } = options;
  if (!name) {
    throw new Error('A kit name is required to generate the PDF.');
  }

  const safeName = sanitizeFileSegment(name);
  const pdfFileName = `rhythm_kit_${safeName}.pdf`;
  const pdfFilePath = path.join('/tmp', pdfFileName);

  await fs.mkdir('/tmp', { recursive: true });

  const pdf = await PDFDocument.create();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const subtitleFont = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

  const palette = resolvePalette(theme, style);
  const page = pdf.addPage([612, 792]); // US Letter portrait
  const { width, height } = page.getSize();

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(...palette.background),
  });

  // Accent ribbon behind title
  page.drawRectangle({
    x: 48,
    y: height - 140,
    width: width - 96,
    height: 90,
    color: rgb(palette.accent[0], palette.accent[1], palette.accent[2]),
    opacity: 0.12,
    borderColor: rgb(palette.accent[0], palette.accent[1], palette.accent[2]),
    borderWidth: 1,
    borderOpacity: 0.25,
  });

  const title = `Custom Rhythm Board – ${name}`;
  const titleSize = STYLE_PRESETS[style].titleSize;
  const titleWidth = titleFont.widthOfTextAtSize(title, titleSize);
  const titleX = Math.max(60, (width - titleWidth) / 2);
  const titleY = height - 90;
  page.drawText(title, {
    x: titleX,
    y: titleY,
    size: titleSize,
    font: titleFont,
    color: rgb(...palette.heading),
  });

  const subtitleText = STYLE_PRESETS[style].subtitle;
  const subtitleSize = STYLE_PRESETS[style].subtitleSize;
  const subtitleWidth = subtitleFont.widthOfTextAtSize(subtitleText, subtitleSize);
  const subtitleX = Math.max(60, (width - subtitleWidth) / 2);
  const subtitleY = titleY - subtitleSize - 14;
  page.drawText(subtitleText, {
    x: subtitleX,
    y: subtitleY,
    size: subtitleSize,
    font: subtitleFont,
    color: rgb(...palette.subtitle),
  });

  const layoutBuffer = await fs.readFile(layoutImagePath);
  const extension = path.extname(layoutImagePath).toLowerCase();
  let layoutImage: PDFImage;
  if (extension === '.jpg' || extension === '.jpeg') {
    layoutImage = await pdf.embedJpg(layoutBuffer);
  } else {
    layoutImage = await pdf.embedPng(layoutBuffer);
  }

  const maxImageWidth = width - 120;
  const maxImageHeight = height * 0.45;
  const scaled = layoutImage.scale(
    Math.min(maxImageWidth / layoutImage.width, maxImageHeight / layoutImage.height, 1),
  );
  const imageX = (width - scaled.width) / 2;
  const imageTop = subtitleY - 36;
  const imageY = Math.max(160, imageTop - scaled.height);

  page.drawRectangle({
    x: imageX - 12,
    y: imageY - 12,
    width: scaled.width + 24,
    height: scaled.height + 24,
    color: rgb(1, 1, 1),
    opacity: 0.85,
    borderColor: rgb(...palette.accent),
    borderWidth: 1.2,
    borderOpacity: 0.4,
  });

  page.drawImage(layoutImage, {
    x: imageX,
    y: imageY,
    width: scaled.width,
    height: scaled.height,
  });

  const qrBlockY = imageY - 100;
  if (qrCodeUrl) {
    const qrImage = await fetchQrImage(pdf, qrCodeUrl);
    if (qrImage) {
      const qrSize = 96;
      const qrX = width - qrSize - 72;
      page.drawRectangle({
        x: qrX - 8,
        y: qrBlockY - 16,
        width: qrSize + 16,
        height: qrSize + 42,
        color: rgb(1, 1, 1),
        opacity: 0.85,
        borderColor: rgb(...palette.accent),
        borderWidth: 1,
        borderOpacity: 0.45,
      });
      page.drawImage(qrImage, { x: qrX, y: qrBlockY, width: qrSize, height: qrSize });
      const qrCaption = style === 'child' ? 'Scan for a celebration playlist' : 'Scan to share a review or gift';
      const captionWidth = bodyFont.widthOfTextAtSize(qrCaption, 10);
      page.drawText(qrCaption, {
        x: qrX + (qrSize - captionWidth) / 2,
        y: qrBlockY - 14,
        size: 10,
        font: bodyFont,
        color: rgb(...palette.text),
      });
    }
  }

  const notesX = 72;
  const notesY = qrBlockY + 32;
  const themeLabel = `Theme: ${theme || 'Custom palette'}`;
  page.drawText(themeLabel, {
    x: notesX,
    y: notesY,
    size: 12,
    font: bodyFont,
    color: rgb(...palette.subtitle),
  });

  const footerText = 'Created by Messy & Magnetic™';
  const footerSize = 11;
  const footerWidth = bodyFont.widthOfTextAtSize(footerText, footerSize);
  page.drawLine({
    start: { x: 60, y: 72 },
    end: { x: width - 60, y: 72 },
    thickness: 1,
    color: rgb(...palette.accent),
    opacity: 0.4,
  });
  page.drawText(footerText, {
    x: (width - footerWidth) / 2,
    y: 52,
    size: footerSize,
    font: bodyFont,
    color: rgb(...palette.text),
  });

  const pdfBytes = await pdf.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  await fs.writeFile(pdfFilePath, pdfBuffer);

  const drive = await getDrive();
  const folder = await ensureDrivePath(drive, ['Messy & Magnetic', 'Rhythm Kits', name.trim() || 'Custom Rhythm Kit']);
  const targetFileName = pdfFileName;

  let fileId: string | undefined;
  try {
    const existing = await drive.files.list({
      q: `'${folder.id}' in parents and name = '${targetFileName.replace(/'/g, "\\'")}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    fileId = existing.data.files?.[0]?.id || undefined;
  } catch (error) {
    console.warn('[generateAndUploadPDF] Unable to lookup existing Drive file:', error);
  }

  if (fileId) {
    await drive.files.update({
      fileId,
      media: { mimeType: 'application/pdf', body: pdfBuffer },
    });
  } else {
    const createRes = await drive.files.create({
      requestBody: {
        name: targetFileName,
        mimeType: 'application/pdf',
        parents: [folder.id!],
      },
      media: { mimeType: 'application/pdf', body: pdfBuffer },
      fields: 'id, webViewLink',
    });
    fileId = createRes.data.id || undefined;
  }

  if (!fileId) {
    throw new Error('Failed to persist PDF to Google Drive.');
  }

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { type: 'anyone', role: 'reader' },
    });
  } catch (error) {
    console.warn('[generateAndUploadPDF] Unable to update Drive permissions:', error);
  }

  const meta = await drive.files.get({ fileId, fields: 'webViewLink, webContentLink' });
  const driveLink =
    meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

  console.log('[generateAndUploadPDF] Generated rhythm kit PDF:', {
    name,
    pdfFilePath,
    driveLink,
  });

  return {
    status: 'success',
    name,
    filePath: pdfFilePath,
    driveLink,
  };
}

