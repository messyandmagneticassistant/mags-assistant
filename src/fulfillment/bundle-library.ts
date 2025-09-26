import type { sheets_v4 } from 'googleapis';
import { appendRows, getSheets } from '../../lib/google';
import { slugify } from '../../utils/slugify';
import type { StoredMagnetBundle } from './magnet-bundles';

const DEFAULT_TAB_NAME = 'Magnet_Bundle_Library';
const HEADER_OFFSET = 2; // Sheet rows start at 1, data begins at row 2.

const COLUMN_INDEX = {
  bundleName: 0,
  owner: 1,
  iconList: 2,
  categories: 3,
  sourceBlueprint: 4,
  createdAt: 5,
  notes: 6,
  lastModifiedAt: 7,
  bundleId: 8,
  sourceBundleId: 9,
} as const;

export interface BundleOwnerContext {
  name?: string;
  household?: string;
  email?: string;
  notes?: string;
  sourceBlueprint?: string;
  referenceBundleId?: string;
  referenceBundleName?: string;
  customTags?: string[];
}

export interface BundleLibraryRow {
  rowNumber: number;
  bundleId: string;
  bundleName: string;
  owner: string;
  iconList: string;
  categories: string;
  sourceBlueprint: string;
  createdAt: string;
  notes: string;
  lastModifiedAt: string;
  sourceBundleId: string;
}

interface LibraryFetchOptions {
  sheetId?: string;
  tabName?: string;
  range?: string;
  sheets?: sheets_v4.Sheets;
}

interface SaveBundleOptions extends LibraryFetchOptions {
  notes?: string;
  sourceBlueprint?: string;
  referenceBundleId?: string;
  referenceBundleName?: string;
}

function resolveSheetId(explicit?: string | null): string | null {
  if (explicit) return explicit;
  if (process.env.MAGNET_BUNDLE_LIBRARY_SHEET_ID) {
    return process.env.MAGNET_BUNDLE_LIBRARY_SHEET_ID;
  }
  if (process.env.BUNDLE_LIBRARY_SHEET_ID) {
    return process.env.BUNDLE_LIBRARY_SHEET_ID;
  }
  return null;
}

function resolveTabName(tabName?: string): string {
  return tabName && tabName.trim() ? tabName : DEFAULT_TAB_NAME;
}

function resolveRange(range?: string, tabName?: string): string {
  if (range && range.trim()) return range;
  return `${resolveTabName(tabName)}!A2:J`;
}

function normalizeOwner(owner: BundleOwnerContext | string): { name: string; notes: string[]; sourceBlueprint?: string; referenceBundleId?: string; referenceBundleName?: string; tags?: string[] } {
  if (typeof owner === 'string') {
    return { name: owner.trim() || 'Unknown', notes: [] };
  }
  const { name, household, email, notes, sourceBlueprint, referenceBundleId, referenceBundleName, customTags } = owner;
  const primary = name?.trim() || household?.trim() || email?.trim() || 'Unknown';
  const collectedNotes = [] as string[];
  if (notes) collectedNotes.push(notes.trim());
  if (household && household.trim() && household.trim() !== primary) {
    collectedNotes.push(`Household: ${household.trim()}`);
  }
  if (email && email.trim()) {
    collectedNotes.push(`Email: ${email.trim()}`);
  }
  return {
    name: primary,
    notes: collectedNotes,
    sourceBlueprint,
    referenceBundleId,
    referenceBundleName,
    tags: customTags,
  };
}

async function fetchSheetRows(opts: LibraryFetchOptions = {}): Promise<BundleLibraryRow[]> {
  const sheetId = resolveSheetId(opts.sheetId || null);
  if (!sheetId) return [];
  const sheets = opts.sheets || (await getSheets());
  const range = resolveRange(opts.range, opts.tabName);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const values = (res.data.values || []) as string[][];
  return values.map((row, index) => ({
    rowNumber: index + HEADER_OFFSET,
    bundleName: row[COLUMN_INDEX.bundleName] || '',
    owner: row[COLUMN_INDEX.owner] || '',
    iconList: row[COLUMN_INDEX.iconList] || '',
    categories: row[COLUMN_INDEX.categories] || '',
    sourceBlueprint: row[COLUMN_INDEX.sourceBlueprint] || '',
    createdAt: row[COLUMN_INDEX.createdAt] || '',
    notes: row[COLUMN_INDEX.notes] || '',
    lastModifiedAt: row[COLUMN_INDEX.lastModifiedAt] || '',
    bundleId: row[COLUMN_INDEX.bundleId] || '',
    sourceBundleId: row[COLUMN_INDEX.sourceBundleId] || '',
  }));
}

function buildCategories(bundle: StoredMagnetBundle): string {
  const parts = new Set<string>();
  if (bundle.category) parts.add(bundle.category);
  for (const tag of bundle.personaTags || []) {
    if (tag) parts.add(tag);
  }
  if (bundle.formats?.length) parts.add(bundle.formats.join('/'));
  return Array.from(parts)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

function buildNotes(
  bundle: StoredMagnetBundle,
  ownerNotes: string[],
  explicitNotes?: string,
  tags?: string[]
): string {
  const entries = new Set<string>();
  for (const note of ownerNotes) {
    if (note) entries.add(note);
  }
  if (explicitNotes) entries.add(explicitNotes);
  const keywordSummary = (bundle.keywords || [])
    .map((kw) => kw.trim())
    .filter(Boolean)
    .join(', ');
  if (keywordSummary) entries.add(`Keywords: ${keywordSummary}`);
  if (tags?.length) entries.add(`Tags: ${tags.join(', ')}`);
  return Array.from(entries).join(' | ');
}

function buildIconList(bundle: StoredMagnetBundle): string {
  return bundle.icons
    .map((icon) => icon?.label?.trim())
    .filter(Boolean)
    .join(', ');
}

async function writeRow(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  rowNumber: number,
  row: string[],
  tabName?: string
): Promise<void> {
  const startCol = 'A';
  const endCol = 'J';
  const targetRange = `${resolveTabName(tabName)}!${startCol}${rowNumber}:${endCol}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: targetRange,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

function buildRowValues(
  bundle: StoredMagnetBundle,
  owner: ReturnType<typeof normalizeOwner>,
  createdAt: string,
  lastModifiedAt: string,
  opts: SaveBundleOptions
): string[] {
  const iconList = buildIconList(bundle);
  const categories = buildCategories(bundle);
  const sourceBlueprint = opts.sourceBlueprint || owner.sourceBlueprint || '';
  const sourceBundleId = opts.referenceBundleId || owner.referenceBundleId || '';
  const notes = buildNotes(bundle, owner.notes, opts.notes || owner.referenceBundleName, owner.tags);
  return [
    bundle.name,
    owner.name,
    iconList,
    categories,
    sourceBlueprint,
    createdAt,
    notes,
    lastModifiedAt,
    bundle.id,
    sourceBundleId || opts.referenceBundleName || owner.referenceBundleName || '',
  ];
}

export async function saveBundleToLibrary(
  bundle: StoredMagnetBundle,
  ownerInput: BundleOwnerContext | string,
  opts: SaveBundleOptions = {}
): Promise<void> {
  const sheetId = resolveSheetId(opts.sheetId || null);
  if (!sheetId) return;
  const sheets = await getSheets();
  const owner = normalizeOwner(ownerInput);
  const rows = await fetchSheetRows({ ...opts, sheets });
  const now = new Date().toISOString();
  let createdAt = now;
  let targetRowNumber: number | null = null;

  const matchById = rows.find((row) => row.bundleId === bundle.id);
  if (matchById) {
    targetRowNumber = matchById.rowNumber;
    createdAt = matchById.createdAt || now;
  } else {
    const matchByName = rows.find(
      (row) =>
        row.bundleName.localeCompare(bundle.name, undefined, { sensitivity: 'accent' }) === 0 &&
        row.owner.localeCompare(owner.name, undefined, { sensitivity: 'accent' }) === 0
    );
    if (matchByName) {
      targetRowNumber = matchByName.rowNumber;
      createdAt = matchByName.createdAt || now;
    }
  }

  const rowValues = buildRowValues(bundle, owner, createdAt, now, opts);

  if (targetRowNumber) {
    await writeRow(sheets, sheetId, targetRowNumber, rowValues, opts.tabName);
  } else {
    await appendRows(sheetId, resolveRange(undefined, opts.tabName), [rowValues]);
  }
}

export async function listBundlesForOwner(ownerQuery: string, opts: LibraryFetchOptions = {}): Promise<BundleLibraryRow[]> {
  const rows = await fetchSheetRows(opts);
  if (!ownerQuery.trim()) return rows;
  const query = ownerQuery.trim().toLowerCase();
  return rows.filter((row) => row.owner.toLowerCase().includes(query));
}

export async function findBundleByName(name: string, opts: LibraryFetchOptions = {}): Promise<BundleLibraryRow | null> {
  if (!name.trim()) return null;
  const rows = await fetchSheetRows(opts);
  const normalized = name.trim().toLowerCase();
  return rows.find((row) => row.bundleName.trim().toLowerCase() === normalized) || null;
}

export interface CloneBundleOptions extends LibraryFetchOptions {
  newOwner?: string;
}

export async function cloneBundleLibraryEntry(
  originalName: string,
  newName: string,
  opts: CloneBundleOptions = {}
): Promise<BundleLibraryRow | null> {
  const sheetId = resolveSheetId(opts.sheetId || null);
  if (!sheetId) return null;
  const sheets = await getSheets();
  const existing = await findBundleByName(originalName, { ...opts, sheets });
  if (!existing) return null;

  const createdAt = new Date().toISOString();
  const owner = opts.newOwner?.trim() || existing.owner || 'Unknown';
  const bundleId = `clone-${slugify(newName || existing.bundleName)}-${Date.now()}`;
  const row: string[] = [
    newName,
    owner,
    existing.iconList,
    existing.categories,
    existing.sourceBlueprint,
    createdAt,
    existing.notes,
    createdAt,
    bundleId,
    existing.bundleId || existing.sourceBundleId || existing.bundleName,
  ];

  await appendRows(sheetId, resolveRange(undefined, opts.tabName), [row]);
  const newRows = await fetchSheetRows({ ...opts, sheets });
  return newRows.find((entry) => entry.bundleId === bundleId) || null;
}

export function formatBundleSummary(row: BundleLibraryRow): string {
  const pieces = [`<b>${row.bundleName}</b> — ${row.owner}`];
  if (row.categories) pieces.push(`Categories: ${row.categories}`);
  if (row.iconList) pieces.push(`Icons: ${row.iconList}`);
  if (row.sourceBlueprint) pieces.push(`Source: ${row.sourceBlueprint}`);
  if (row.lastModifiedAt) pieces.push(`Updated: ${row.lastModifiedAt}`);
  if (row.notes) pieces.push(`Notes: ${row.notes}`);
  return pieces.join('\n');
}
