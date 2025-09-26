import { Buffer } from 'buffer';
import { ensureOrderWorkspace, ensureFolder, loadIconLibrary, validateEmail } from './common';
import type { NormalizedIntake, IconBundleResult, IconAsset, FulfillmentWorkspace } from './types';
import {
  resolveMagnetBundlePlan,
  persistBundlePlanArtifacts,
  buildFallbackIconRequests,
  type MagnetIconRequest,
  type MagnetBundlePlan,
} from './magnet-bundles';
import { appendRows } from '../../lib/google';
import { sendEmail } from '../../utils/email';
import { tgSend } from '../../lib/telegram';
import { slugify } from '../../utils/slugify';

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

  const ownerContext: BundleOwnerContext = { intake, workspace, plan, icons, manifest };
  let savedAsset: SavedBundleAsset | null = null;
  try {
    savedAsset = await saveBundleToDrive(plan.bundle.name, ownerContext);
  } catch (err) {
    console.warn('[fulfillment.icons] failed to archive bundle asset:', err);
  }

  const deliveryChannels: string[] = [];
  if (savedAsset) deliveryChannels.push('drive');

  const downloadUrl =
    savedAsset?.fileUrl || iconFolder.webViewLink || manifestFile.data.webViewLink || icons[0]?.url || '';

  let telegramResult: TelegramDeliveryResult | null = null;
  if (downloadUrl) {
    telegramResult = await notifyBundleOwnerViaTelegram(ownerContext, plan.bundle.name, downloadUrl);
    if (telegramResult?.ok) {
      deliveryChannels.push('telegram');
    }
  }

  let emailReceipt: Awaited<ReturnType<typeof sendEmail>> | null = null;
  if (downloadUrl && (!telegramResult || !telegramResult.ok)) {
    emailReceipt = await sendBundleEmail(ownerContext, downloadUrl, opts.env);
    if (emailReceipt) {
      deliveryChannels.push('email');
    }
  }

  await logBundleDelivery(ownerContext, savedAsset, telegramResult, emailReceipt, downloadUrl);

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
    bundleFileId: savedAsset?.fileId,
    bundleFileUrl: savedAsset?.fileUrl,
    deliveryChannels: deliveryChannels.length ? deliveryChannels : undefined,
  };
}

interface BundleOwnerContext {
  intake: NormalizedIntake;
  workspace: FulfillmentWorkspace;
  plan: MagnetBundlePlan;
  icons: IconAsset[];
  manifest: Record<string, any>;
}

interface SavedBundleAsset {
  fileId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  folderId: string;
  folderUrl?: string;
  householdName: string;
}

interface TelegramDeliveryResult {
  ok: boolean;
  chatId?: string;
  status?: number;
  error?: string;
}

interface BundleAssetPayload {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export async function saveBundleToDrive(bundleName: string, owner: BundleOwnerContext): Promise<SavedBundleAsset> {
  const drive = owner.workspace.drive;
  const rootFolderId = owner.workspace.rootFolderId;
  const magnetRoot = await ensureFolder(drive, rootFolderId, 'MagnetBundles');
  const householdName = resolveHouseholdName(owner.intake);
  const householdFolder = await ensureFolder(drive, magnetRoot.id!, householdName);

  const asset = buildBundleAsset(bundleName, owner.plan, owner.icons, householdName);

  const created = await drive.files.create({
    requestBody: {
      name: asset.fileName,
      mimeType: asset.mimeType,
      parents: [householdFolder.id!],
    },
    media: { mimeType: asset.mimeType, body: asset.buffer },
    fields: 'id, webViewLink, webContentLink',
  });

  return {
    fileId: created.data.id || '',
    fileUrl: created.data.webViewLink || created.data.webContentLink || '',
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    folderId: householdFolder.id!,
    folderUrl: householdFolder.webViewLink || '',
    householdName,
  };
}

function resolveHouseholdName(intake: NormalizedIntake): string {
  const prefs = intake.prefs || {};
  const candidates = [
    prefs.household,
    prefs.household_type,
    prefs.family_structure,
    prefs.family,
    prefs.family_name,
    intake.customer?.lastName ? `${intake.customer.lastName} household` : undefined,
    intake.customer?.name,
  ];
  for (const value of candidates) {
    const formatted = formatDriveComponent(value, '');
    if (formatted) return formatted;
  }
  const fallback = intake.customer?.firstName ? `${intake.customer.firstName} household` : 'General Household';
  return formatDriveComponent(fallback, 'Household');
}

function formatDriveComponent(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const cleaned = value
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) {
    return cleaned.slice(0, 80);
  }
  return fallback;
}

function buildBundleAsset(
  bundleName: string,
  plan: MagnetBundlePlan,
  icons: IconAsset[],
  householdName: string
): BundleAssetPayload {
  const baseName = formatDriveComponent(bundleName, slugify(bundleName || 'bundle'));
  const summaryLines = buildBundleSummaryLines(plan, icons, householdName);
  if (plan.format === 'svg' || plan.format === 'svg-sheet') {
    const svgBuffer = buildBundleSvg(bundleName, summaryLines, icons);
    return { buffer: svgBuffer, mimeType: 'image/svg+xml', fileName: `${baseName}.svg` };
  }
  const pdfBuffer = buildBundlePdf(bundleName, summaryLines);
  return { buffer: pdfBuffer, mimeType: 'application/pdf', fileName: `${baseName}.pdf` };
}

function buildBundleSummaryLines(plan: MagnetBundlePlan, icons: IconAsset[], householdName: string): string[] {
  const lines: string[] = [];
  lines.push(`Household: ${householdName}`);
  if (plan.bundle.category) lines.push(`Category: ${plan.bundle.category}`);
  if (plan.personalization.familyName) lines.push(`Family: ${plan.personalization.familyName}`);
  if (plan.personalization.childName) lines.push(`Child: ${plan.personalization.childName}`);
  lines.push(`Format: ${plan.format}`);
  lines.push(`Source: ${plan.source}`);
  if (plan.keywords?.length) lines.push(`Keywords: ${plan.keywords.join(', ')}`);
  lines.push(`Icon count: ${icons.length}`);
  lines.push('Icons:');
  for (const icon of icons) {
    lines.push(`- ${icon.name}`);
  }
  return wrapSummaryLines(lines);
}

function wrapSummaryLines(lines: string[], maxLength = 90): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    if (line.length <= maxLength) {
      wrapped.push(line);
      continue;
    }
    const words = line.split(' ');
    let current = '';
    for (const word of words) {
      const tentative = current ? `${current} ${word}` : word;
      if (tentative.length > maxLength && current) {
        wrapped.push(current);
        current = word;
      } else {
        current = tentative;
      }
    }
    if (current) wrapped.push(current);
  }
  return wrapped;
}

function buildBundleSvg(bundleName: string, summary: string[], icons: IconAsset[]): Buffer {
  const width = 900;
  const lineHeight = 28;
  const headerLines = summary.length;
  const totalLines = headerLines + icons.length;
  const height = Math.max(360, 120 + totalLines * lineHeight);
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const summaryText = summary
    .map((line, idx) => `    <text x="48" y="${80 + idx * lineHeight}" font-size="18" fill="#1a1a1a">${escape(line)}</text>`)
    .join('\n');

  const iconText = icons
    .map((icon, idx) => `    <text x="64" y="${80 + (headerLines + idx) * lineHeight}" font-size="16" fill="#333">• ${escape(icon.name)}</text>`)
    .join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#f8f5ff" rx="32" />
  <text x="48" y="48" font-family="'Poppins', 'Arial', sans-serif" font-size="28" font-weight="600" fill="#5b3cc4">${escape(
    bundleName
  )}</text>
${summaryText}
${iconText}
</svg>`;
  return Buffer.from(svg, 'utf8');
}

function escapePdfText(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildBundlePdf(bundleName: string, summary: string[]): Buffer {
  const contentParts: string[] = [];
  contentParts.push('BT');
  contentParts.push('/F1 20 Tf');
  contentParts.push('72 760 Td');
  contentParts.push(`(${escapePdfText(bundleName)}) Tj`);
  if (summary.length) {
    contentParts.push('/F1 12 Tf');
    contentParts.push('0 -28 Td');
    for (const line of summary) {
      contentParts.push(`(${escapePdfText(line)}) Tj`);
      contentParts.push('0 -16 Td');
    }
  }
  contentParts.push('ET');
  const content = contentParts.join('\n');
  const contentLength = Buffer.byteLength(content, 'utf8');

  const objects = [
    '',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentLength} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  const header = '%PDF-1.4\n';
  const parts: string[] = [header];
  let offset = Buffer.byteLength(header, 'utf8');
  const xrefEntries: string[] = ['0000000000 65535 f \n'];

  for (let i = 1; i < objects.length; i++) {
    const obj = objects[i];
    xrefEntries.push(`${offset.toString().padStart(10, '0')} 00000 n \n`);
    parts.push(obj);
    offset += Buffer.byteLength(obj, 'utf8');
  }

  const xrefOffset = offset;
  const xref = `xref\n0 ${objects.length}\n${xrefEntries.join('')}`;
  parts.push(xref);
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(trailer);

  return Buffer.from(parts.join(''), 'utf8');
}

function extractTelegramChatId(intake: NormalizedIntake): string | undefined {
  const prefs = intake.prefs || {};
  const customer = (intake.customer || {}) as Record<string, any>;
  const candidates = [
    prefs.telegram_chat_id,
    prefs.telegram_chat,
    prefs.telegram,
    prefs.telegram_id,
    prefs.telegram_handle,
    prefs.contact_telegram,
    customer.telegramChatId,
    customer.telegramId,
    customer.telegram,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

async function notifyBundleOwnerViaTelegram(
  context: BundleOwnerContext,
  bundleName: string,
  url: string
): Promise<TelegramDeliveryResult | null> {
  const chatId = extractTelegramChatId(context.intake);
  if (!chatId) return null;
  const message = `Your ${bundleName} is ready! Download: ${url}`;
  try {
    const response: any = await tgSend(message, chatId);
    return {
      ok: Boolean(response?.ok),
      chatId,
      status: typeof response?.status === 'number' ? response.status : undefined,
      error: response?.reason,
    };
  } catch (err) {
    console.warn('[fulfillment.icons] failed to send Telegram notification:', err);
    return {
      ok: false,
      chatId,
      error: err instanceof Error ? err.message : 'unknown-error',
    };
  }
}

async function sendBundleEmail(
  context: BundleOwnerContext,
  downloadUrl: string,
  env?: any
): Promise<Awaited<ReturnType<typeof sendEmail>> | null> {
  if (!validateEmail(context.intake.email)) return null;
  const greeting = context.intake.customer?.firstName || context.intake.customer?.name || 'Hi friend';
  const subject = `Your ${context.plan.bundle.name} magnet bundle is ready`;
  const text = `${greeting},\n\nYour custom magnet bundle is attached here: ${downloadUrl}\n\nWith warmth,\nMaggie`;
  const html = `
    <p>${greeting},</p>
    <p>Your custom magnet bundle is attached / linked here:</p>
    <p><a href="${downloadUrl}">Download your magnet bundle</a></p>
    <p>With warmth,<br/>Maggie</p>
  `;
  try {
    return await sendEmail({ to: context.intake.email, subject, text, html }, env);
  } catch (err) {
    console.warn('[fulfillment.icons] failed to send bundle email:', err);
    return null;
  }
}

async function logBundleDelivery(
  context: BundleOwnerContext,
  asset: SavedBundleAsset | null,
  telegram: TelegramDeliveryResult | null,
  emailResult: Awaited<ReturnType<typeof sendEmail>> | null,
  downloadUrl: string
): Promise<void> {
  const sheetId = context.workspace.config.sheetId;
  if (!sheetId) return;
  const channels: string[] = [];
  if (asset) channels.push('drive');
  if (telegram) channels.push(`telegram:${telegram.ok ? 'ok' : 'failed'}`);
  if (emailResult) channels.push('email');
  const row = [
    new Date().toISOString(),
    context.intake.email || '',
    context.plan.bundle.name,
    context.plan.format,
    asset?.householdName || resolveHouseholdName(context.intake),
    downloadUrl,
    channels.join(', '),
  ];
  try {
    await appendRows(sheetId, 'Magnet_Bundle_Library!A2:G', [row]);
  } catch (err) {
    console.warn('[fulfillment.icons] failed to log magnet bundle delivery:', err);
  }
}
