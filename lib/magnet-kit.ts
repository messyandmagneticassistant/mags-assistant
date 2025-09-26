import path from 'path';
import { promises as fs } from 'fs';
import { Buffer } from 'buffer';

import { createCustomIconSheet } from '../utils/icon-generator';
import { appendRows } from './google';
import { tgSend } from './telegram';

type QRRecipient = { userId?: string; email?: string };

export type MagnetFormat =
  | 'pdf'
  | 'svg'
  | 'vinyl'
  | 'printable'
  | 'cling'
  | 'digital'
  | 'svg-sheet';

interface MagnetKitOptions extends QRRecipient {
  userId: string;
  icons: string[];
  format: MagnetFormat;
  bundleName?: string;
  feedbackUrl?: string;
}

export interface BundlePdfLayout {
  format: MagnetFormat;
  icons: Array<{ slot: number; tag: string }>;
  metadata: {
    userId: string;
    bundleName: string;
    generatedAt: string;
    sourceSheet?: string;
  };
  footer?: {
    note?: string;
    qr?: FeedbackQRBlock;
  };
  feedback?: FeedbackQRBlock;
}

export interface FeedbackQRBlock {
  text: string;
  url: string;
  qrDataUrl: string;
  createdAt: string;
}

export interface MagnetKitResult {
  format: MagnetFormat;
  link: string;
  feedbackLink?: string | null;
}

interface AddFeedbackQROptions extends QRRecipient {
  feedbackUrl: string;
  text?: string;
}

function buildSvgQrPlaceholder(url: string) {
  const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#0f172a" rx="16" />
  <text x="90" y="96" text-anchor="middle" fill="#f8fafc" font-family="'Arial', 'Helvetica', sans-serif" font-size="14">
    QR →
  </text>
  <text x="90" y="118" text-anchor="middle" fill="#f8fafc" font-family="'Arial', 'Helvetica', sans-serif" font-size="10">
    ${escaped}
  </text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function decorateLink(baseUrl: string, { userId, email }: QRRecipient): string {
  try {
    const url = new URL(baseUrl);
    if (userId) {
      url.searchParams.set('user_id', userId);
    } else if (email) {
      url.searchParams.set('email', email);
    }
    return url.toString();
  } catch {
    // If the URL is invalid fall back to returning the raw string.
    return baseUrl;
  }
}

async function logFeedbackCreation(
  sheetId: string | undefined,
  bundleName: string,
  userId: string,
  feedbackUrl: string
) {
  if (!sheetId) return;
  try {
    await appendRows(sheetId, 'BundleFeedback_Log!A2:D', [
      [new Date().toISOString(), bundleName, userId, feedbackUrl],
    ]);
  } catch (err) {
    console.warn('[magnet-kit] failed to log bundle feedback QR:', err);
  }
}

async function notifyFeedbackViaTelegram(feedbackUrl: string) {
  try {
    await tgSend(
      `Here’s your rhythm bundle 🧲 If anything feels off, scan the QR to adjust.\n${feedbackUrl}`
    );
  } catch (err) {
    console.warn('[magnet-kit] failed to send Telegram notification:', err);
  }
}

export function addFeedbackQR(pdf: BundlePdfLayout, opts: AddFeedbackQROptions): BundlePdfLayout {
  if (!opts.feedbackUrl) return pdf;
  const finalUrl = decorateLink(opts.feedbackUrl, { userId: opts.userId, email: opts.email });
  const qrDataUrl = buildSvgQrPlaceholder(finalUrl);
  const text = opts.text ?? 'Scan to update your rhythm or request edits 🌀';
  const block: FeedbackQRBlock = {
    text,
    url: finalUrl,
    qrDataUrl,
    createdAt: new Date().toISOString(),
  };
  return {
    ...pdf,
    feedback: block,
    footer: {
      ...(pdf.footer || {}),
      note: text,
      qr: { ...block },
    },
  };
}

function buildBaseLayout(opts: MagnetKitOptions, sheetLink: string): BundlePdfLayout {
  const generatedAt = new Date().toISOString();
  return {
    format: opts.format,
    icons: opts.icons.map((tag, idx) => ({ slot: idx + 1, tag })),
    metadata: {
      userId: opts.userId,
      bundleName: opts.bundleName || 'Rhythm Bundle',
      generatedAt,
      sourceSheet: sheetLink || undefined,
    },
  };
}

function shouldEmbedFeedback(format: MagnetFormat) {
  return format === 'pdf' || format === 'printable';
}

function resolveFeedbackUrl(opts: MagnetKitOptions): string | null {
  const raw = opts.feedbackUrl || process.env.BUNDLE_FEEDBACK_URL || '';
  return raw ? decorateLink(raw, { userId: opts.userId, email: opts.email }) : null;
}

/**
 * Create a full magnet kit for a user. Generates an icon sheet reference and
 * produces a lightweight PDF layout representation including a feedback QR.
 */
export async function createMagnetKit(opts: MagnetKitOptions): Promise<MagnetKitResult> {
  const { userId, icons, format } = opts;
  const baseDir = path.join('/tmp', 'magnet-kits', userId);
  await fs.mkdir(baseDir, { recursive: true });

  const sheetLink = await createCustomIconSheet(userId, icons);
  let layout = buildBaseLayout(opts, sheetLink);
  let feedbackLink: string | null = null;

  if (shouldEmbedFeedback(format)) {
    const resolved = resolveFeedbackUrl(opts);
    if (resolved) {
      feedbackLink = resolved;
      layout = addFeedbackQR(layout, {
        feedbackUrl: resolved,
        userId: opts.userId,
        email: opts.email,
      });
      await logFeedbackCreation(
        process.env.BUNDLE_FEEDBACK_SHEET_ID,
        layout.metadata.bundleName,
        opts.userId,
        resolved
      );
      await notifyFeedbackViaTelegram(resolved);
    }
  }

  const file = path.join(baseDir, `magnet-kit.${format === 'pdf' || format === 'printable' ? 'json' : 'svg'}`);
  const payload =
    format === 'pdf' || format === 'printable'
      ? JSON.stringify(layout, null, 2)
      : `Generated from ${sheetLink}`;

  await fs.writeFile(file, payload, 'utf8');

  return {
    format,
    link: `file://${file}`,
    feedbackLink,
  };
}
