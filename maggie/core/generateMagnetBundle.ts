import { slugify } from '../../utils/slugify';
import { getDrive, getSheets } from '../../lib/google';
import type { drive_v3 } from 'googleapis';

interface IconLibraryEntry {
  slug: string;
  name: string;
  fileId?: string;
  tone?: string;
  ageRanges?: string[];
  tags?: string[];
  folderUrl?: string;
}

export type MagnetAgeBracket = 'toddler' | 'child' | 'teen' | 'adult' | 'elder';

export interface MagnetBundleProfile {
  id?: string;
  name?: string;
  customLabel?: string;
  household?: string;
  householdRole?: string;
  householdSize?: number;
  humanDesignType?: string;
  lifeType?: string;
  age?: number | MagnetAgeBracket;
  ageBracket?: MagnetAgeBracket;
  children?: Array<{
    name?: string;
    age?: number | MagnetAgeBracket;
    humanDesignType?: string;
    sensitivity?: string;
  }>;
  quizResults?: Record<string, any>;
  quizTags?: string[];
  soulBlueprint?: {
    sun?: string;
    moon?: string;
    rising?: string;
    lifePath?: string;
    enneagram?: string;
    archetypes?: string[];
    notes?: string;
  };
  customNeeds?: string[];
  neurodivergence?: string[];
  sensitivities?: string[];
  focusAreas?: string[];
  goals?: string[];
  requestedBy?: string;
  contact?: {
    email?: string;
    telegram?: string;
  };
}

export interface MagnetBundleIcon {
  slug: string;
  label: string;
  description: string;
  tags: string[];
  reasons: string[];
  librarySlug?: string;
  libraryName?: string;
  driveFileId?: string;
  tone?: string;
  ageRanges?: string[];
}

export interface HelperBotDirective {
  name: 'namer' | 'designer' | 'categorizer';
  instructions: string;
  payload?: Record<string, any>;
}

export interface GeneratedMagnetBundle {
  id: string;
  slug: string;
  name: string;
  description: string;
  profile: MagnetBundleProfile;
  traits: string[];
  icons: MagnetBundleIcon[];
  helpers: HelperBotDirective[];
  createdAt: string;
  source: 'generated' | 'retrieved';
  storage?: {
    driveFileId?: string;
    driveFileUrl?: string;
    sheetRowAppended?: boolean;
    cacheUpdated?: boolean;
  };
}

export interface PersistResult {
  driveFileId?: string;
  driveFileUrl?: string;
  sheetRowAppended?: boolean;
  cacheUpdated?: boolean;
}

export interface GenerateMagnetBundleOptions {
  persist?: boolean;
  minIcons?: number;
  requestedBy?: string;
  driveFolderId?: string;
  sheetId?: string;
  env?: any;
}

export interface MagnetBundleQuery {
  name?: string;
  household?: string;
  profileId?: string;
  trait?: string | string[];
  humanDesignType?: string;
  customFilter?: (bundle: GeneratedMagnetBundle) => boolean;
}

interface IconDefinition {
  key: string;
  label: string;
  description: string;
  tags: string[];
  baseWeight: number;
  librarySlug: string;
  hdTypes?: string[];
  roles?: string[];
  ages?: MagnetAgeBracket[];
  quizHints?: string[];
  soulHints?: string[];
  customNeeds?: string[];
  lifeTypes?: string[];
  householdHints?: string[];
}

interface CacheEntry extends GeneratedMagnetBundle {}

const MEMORY_CACHE: CacheEntry[] = [];

const FALLBACK_ICON_LIBRARY: IconLibraryEntry[] = [
  {
    slug: 'sunrise-anchor',
    name: 'Sunrise Anchor',
    fileId: '1A2B3Csunrise',
    tone: 'soft',
    ageRanges: ['adult', 'teen'],
    tags: ['morning', 'calm', 'breath'],
  },
  {
    slug: 'midday-spark',
    name: 'Midday Spark',
    fileId: '1A2B3Cspark',
    tone: 'bright',
    ageRanges: ['adult'],
    tags: ['midday', 'creative', 'focus'],
  },
  {
    slug: 'evening-soften',
    name: 'Evening Soften',
    fileId: '1A2B3Csoften',
    tone: 'soft',
    ageRanges: ['adult', 'child'],
    tags: ['evening', 'rest', 'moon'],
  },
  {
    slug: 'weekly-reset',
    name: 'Weekly Reset',
    fileId: '1A2B3Creset',
    tone: 'earthy',
    ageRanges: ['adult', 'teen'],
    tags: ['weekly', 'reset', 'ritual'],
  },
  {
    slug: 'family-circle',
    name: 'Family Circle',
    fileId: '1A2B3Cfamily',
    tone: 'bright',
    ageRanges: ['child', 'adult'],
    tags: ['family', 'connection'],
  },
];

const ICON_DEFINITIONS: IconDefinition[] = [
  {
    key: 'water-intake',
    label: 'Water Intake',
    description: 'Track hydration boosts during high-output stretches.',
    tags: ['hydrate', 'wellness', 'sacral-reset'],
    baseWeight: 3,
    librarySlug: 'sunrise-anchor',
    hdTypes: ['mg', 'generator'],
    lifeTypes: ['wellness', 'business'],
  },
  {
    key: 'temple-time',
    label: 'Temple Time',
    description: 'Daily sacred solo pocket for prayer, journaling, or quiet.',
    tags: ['self-care', 'sacred', 'solo'],
    baseWeight: 4,
    librarySlug: 'evening-soften',
    roles: ['solo mom', 'parent', 'caregiver'],
  },
  {
    key: 'hd-chart',
    label: 'HD Chart Sync',
    description: 'Review human design cues before planning the day.',
    tags: ['human design', 'planning'],
    baseWeight: 2,
    librarySlug: 'sunrise-anchor',
    hdTypes: ['projector', 'manifestor', 'reflector', 'generator', 'mg'],
  },
  {
    key: 'lunch-helper',
    label: 'Lunch Helper',
    description: 'Assign a kiddo to prep/plates for midday meals.',
    tags: ['family', 'chores', 'midday'],
    baseWeight: 3,
    librarySlug: 'midday-spark',
    roles: ['parent', 'solo mom'],
    householdHints: ['household', 'family'],
  },
  {
    key: 'chore-dice',
    label: 'Chore Dice',
    description: 'Gamify chores with dice or cards to keep momentum playful.',
    tags: ['adhd', 'momentum', 'fun'],
    baseWeight: 4,
    librarySlug: 'midday-spark',
    quizHints: ['adhd', 'executive dysfunction'],
    customNeeds: ['adhd', 'executive support'],
  },
  {
    key: 'quiet-reset',
    label: 'Quiet Reset',
    description: 'Gentle sensory break with dim lights or noise-canceling.',
    tags: ['sensitivity', 'reset', 'nervous system'],
    baseWeight: 4,
    librarySlug: 'evening-soften',
    quizHints: ['high sensitivity', 'hsp', 'overwhelm'],
    customNeeds: ['sensory', 'autism', 'hsp'],
  },
  {
    key: 'play-cleanup',
    label: 'Play Cleanup',
    description: 'Two-song tidy sprint after play or homeschool blocks.',
    tags: ['kids', 'reset', 'play'],
    baseWeight: 3,
    librarySlug: 'family-circle',
    ages: ['toddler', 'child'],
    householdHints: ['homeschool', 'family'],
  },
  {
    key: 'bedtime-star',
    label: 'Bedtime Star',
    description: 'Nighttime star chart for teeth, pajamas, and tuck-ins.',
    tags: ['bedtime', 'kids', 'routine'],
    baseWeight: 3,
    librarySlug: 'evening-soften',
    ages: ['toddler', 'child'],
  },
  {
    key: 'tidy-space',
    label: 'Tidy Space',
    description: 'Declutter cue for Virgo/earth blueprint placements.',
    tags: ['virgo', 'order', 'grounding'],
    baseWeight: 3,
    librarySlug: 'weekly-reset',
    soulHints: ['virgo'],
  },
  {
    key: 'creative-time',
    label: 'Creative Time',
    description: 'Open a playful art/story window to honor Life Path 3 energy.',
    tags: ['creative', 'expression'],
    baseWeight: 4,
    librarySlug: 'midday-spark',
    soulHints: ['life path 3'],
  },
  {
    key: 'sensory-den',
    label: 'Sensory Den',
    description: 'Build a cushy nook for regulation and nervous-system downshifts.',
    tags: ['sensory', 'regulation'],
    baseWeight: 4,
    librarySlug: 'evening-soften',
    customNeeds: ['autism', 'sensory', 'neurodivergent'],
    quizHints: ['sensory'],
  },
  {
    key: 'outreach-pulse',
    label: 'Outreach Pulse',
    description: 'Short touchpoints for Projectors/Manifestors to share invites.',
    tags: ['connection', 'outreach'],
    baseWeight: 2,
    librarySlug: 'family-circle',
    hdTypes: ['projector', 'manifestor'],
    goals: ['community', 'business'],
  },
  {
    key: 'slow-morning',
    label: 'Slow Morning',
    description: 'Keep mornings soft and reflective for lunar/Reflector charts.',
    tags: ['morning', 'moon'],
    baseWeight: 3,
    librarySlug: 'sunrise-anchor',
    hdTypes: ['reflector'],
    soulHints: ['moon'],
  },
  {
    key: 'body-break',
    label: 'Body Break',
    description: 'Movement snack: stretch, dance, or shake between tasks.',
    tags: ['movement', 'reset'],
    baseWeight: 3,
    librarySlug: 'midday-spark',
    quizHints: ['burnout', 'fatigue'],
    customNeeds: ['adhd', 'executive support'],
  },
  {
    key: 'gratitude-glow',
    label: 'Gratitude Glow',
    description: 'Evening gratitude share for the household.',
    tags: ['gratitude', 'family'],
    baseWeight: 2,
    librarySlug: 'evening-soften',
    householdHints: ['family', 'partner'],
  },
  {
    key: 'check-in-circle',
    label: 'Check-in Circle',
    description: 'Weekly family huddle to name energy levels + tasks.',
    tags: ['family', 'weekly'],
    baseWeight: 2,
    librarySlug: 'family-circle',
    householdHints: ['family', 'homeschool'],
  },
  {
    key: 'weekend-reset',
    label: 'Weekend Reset',
    description: 'Ground the home with a weekend tidy/reset sweep.',
    tags: ['reset', 'weekend'],
    baseWeight: 2,
    librarySlug: 'weekly-reset',
    householdHints: ['household', 'solo'],
  },
  {
    key: 'meal-prep',
    label: 'Meal Prep Pulse',
    description: 'Batch cook or prep ingredients to ease the week.',
    tags: ['kitchen', 'prep'],
    baseWeight: 2,
    librarySlug: 'sunrise-anchor',
    roles: ['solo mom', 'parent'],
  },
  {
    key: 'field-trip',
    label: 'Field Trip Day',
    description: 'Plan a hands-on outing or co-op adventure.',
    tags: ['learning', 'homeschool'],
    baseWeight: 2,
    librarySlug: 'midday-spark',
    householdHints: ['homeschool'],
  },
  {
    key: 'elder-care',
    label: 'Elder Care Tender',
    description: 'Support check for elder or caregiving households.',
    tags: ['caregiving', 'elder'],
    baseWeight: 2,
    librarySlug: 'evening-soften',
    roles: ['caregiver', 'elder support'],
  },
];

let iconLibraryCache: IconLibraryEntry[] | null = null;
let cachePath: string | null = null;

const hasNodeRuntime = typeof process !== 'undefined' && !!process.versions?.node;

async function ensureCachePath(): Promise<string | null> {
  if (!hasNodeRuntime) return null;
  if (cachePath) return cachePath;
  const pathMod = await import('path');
  cachePath = pathMod.resolve(process.cwd(), 'data', 'magnet-bundle-cache.json');
  return cachePath;
}

async function ensureFs() {
  const fs = await import('fs/promises');
  return fs;
}

async function loadIconLibrary(): Promise<IconLibraryEntry[]> {
  if (iconLibraryCache) return iconLibraryCache;
  if (hasNodeRuntime) {
    try {
      const mod = await import('../../src/fulfillment/common');
      if (typeof (mod as any).loadIconLibrary === 'function') {
        const icons = await (mod as any).loadIconLibrary();
        if (Array.isArray(icons) && icons.length) {
          iconLibraryCache = icons;
          return iconLibraryCache;
        }
      }
    } catch (err) {
      console.warn('[magnet-bundle] failed to load icon library from fulfillment config:', err);
    }
  }
  iconLibraryCache = FALLBACK_ICON_LIBRARY;
  return iconLibraryCache;
}

function normalize(str?: string): string {
  return (str || '').toLowerCase().trim();
}

function normalizeAgeValue(value?: number | string | MagnetAgeBracket | null): MagnetAgeBracket | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase().trim();
    if (['toddler', 'child', 'teen', 'adult', 'elder'].includes(lowered)) {
      return lowered as MagnetAgeBracket;
    }
    const numeric = Number.parseFloat(lowered.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(numeric)) {
      return normalizeAgeValue(numeric);
    }
    return undefined;
  }
  if (typeof value === 'number') {
    if (value <= 5) return 'toddler';
    if (value <= 12) return 'child';
    if (value <= 19) return 'teen';
    if (value >= 60) return 'elder';
    return 'adult';
  }
  return undefined;
}

function detectAgeBracket(profile: MagnetBundleProfile): MagnetAgeBracket {
  return normalizeAgeValue(profile.ageBracket || profile.age) || 'adult';
}

function humanDesignKeywords(type?: string): string[] {
  const value = normalize(type);
  if (!value) return [];
  if (['manifesting generator', 'manifesting-generator', 'mg'].some((hint) => value.includes(hint))) {
    return ['mg', 'generator'];
  }
  if (value.includes('generator')) return ['generator'];
  if (value.includes('projector')) return ['projector'];
  if (value.includes('manifestor')) return ['manifestor'];
  if (value.includes('reflector')) return ['reflector'];
  return [value];
}

function soulTraitKeywords(soul?: MagnetBundleProfile['soulBlueprint']): string[] {
  if (!soul) return [];
  const traits: string[] = [];
  for (const value of [soul.sun, soul.moon, soul.rising, soul.lifePath, soul.enneagram]) {
    const normalized = normalize(value);
    if (normalized) traits.push(normalized);
  }
  if (Array.isArray(soul.archetypes)) {
    for (const archetype of soul.archetypes) {
      const normalized = normalize(archetype);
      if (normalized) traits.push(normalized);
    }
  }
  if (typeof soul.notes === 'string') {
    const lowered = soul.notes.toLowerCase();
    if (lowered.includes('virgo')) traits.push('virgo');
    if (lowered.includes('creative')) traits.push('creative');
  }
  const expanded: string[] = [];
  for (const trait of traits) {
    const parts = trait.split(/\s+/).filter(Boolean);
    expanded.push(trait, ...parts);
  }
  return Array.from(new Set(expanded));
}

function flattenStrings(input?: string | string[] | null): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map((item) => item.toLowerCase());
  return input
    .split(/[;,]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function collectTraitTags(profile: MagnetBundleProfile): string[] {
  const tags = new Set<string>();
  const hd = humanDesignKeywords(profile.humanDesignType);
  hd.forEach((tag) => tags.add(tag));
  const household = normalize(profile.household || profile.householdRole);
  if (household) tags.add(household);
  if (profile.lifeType) tags.add(normalize(profile.lifeType));
  const age = detectAgeBracket(profile);
  tags.add(age);
  for (const child of profile.children || []) {
    const childAge = typeof child.age === 'string' ? child.age : undefined;
    if (childAge) tags.add(normalize(childAge));
    const hdHints = humanDesignKeywords(child.humanDesignType);
    hdHints.forEach((tag) => tags.add(`${tag}-child`));
  }
  flattenStrings(profile.quizTags).forEach((tag) => tags.add(tag));
  flattenStrings(profile.neurodivergence).forEach((tag) => tags.add(tag));
  flattenStrings(profile.customNeeds).forEach((tag) => tags.add(tag));
  flattenStrings(profile.sensitivities).forEach((tag) => tags.add(tag));
  flattenStrings(profile.focusAreas).forEach((tag) => tags.add(tag));
  flattenStrings(profile.goals).forEach((tag) => tags.add(tag));
  soulTraitKeywords(profile.soulBlueprint).forEach((tag) => tags.add(tag));
  if (profile.quizResults) {
    const flattened = JSON.stringify(profile.quizResults).toLowerCase();
    if (flattened.includes('sensory')) tags.add('sensory');
    if (flattened.includes('sensitivity')) tags.add('high sensitivity');
    if (flattened.includes('adhd')) tags.add('adhd');
  }
  return Array.from(tags);
}

function matchScore(profile: MagnetBundleProfile, icon: IconDefinition): { score: number; reasons: string[] } {
  let score = icon.baseWeight;
  const reasons: string[] = [];
  const hdHints = humanDesignKeywords(profile.humanDesignType);
  const traitTags = collectTraitTags(profile);
  const age = detectAgeBracket(profile);
  const childAges = (profile.children || [])
    .map((child) => normalizeAgeValue(child?.age as any))
    .filter((value): value is MagnetAgeBracket => Boolean(value));
  const childHdHints = (profile.children || [])
    .flatMap((child) => humanDesignKeywords(child.humanDesignType));
  const combinedHdHints = [...hdHints, ...childHdHints];

  if (icon.hdTypes?.some((type) => combinedHdHints.includes(type) || hdHints.includes(type))) {
    score += 4;
    reasons.push('human design match');
  }
  if (icon.roles?.some((role) => normalize(profile.householdRole)?.includes(role) || normalize(profile.household)?.includes(role))) {
    score += 3;
    reasons.push('role support');
  }
  if (icon.ages?.some((bucket) => bucket === age || childAges.includes(bucket))) {
    score += 3;
    reasons.push('age bracket');
  }
  if (icon.quizHints?.some((hint) => traitTags.includes(hint))) {
    score += 3;
    reasons.push('quiz alignment');
  }
  if (icon.soulHints?.some((hint) => traitTags.includes(hint))) {
    score += 2;
    reasons.push('soul blueprint');
  }
  if (icon.customNeeds?.some((need) => traitTags.includes(need))) {
    score += 3;
    reasons.push('custom support');
  }
  if (icon.lifeTypes?.some((type) => traitTags.includes(type))) {
    score += 1;
    reasons.push('life type');
  }
  if (icon.householdHints?.some((hint) => traitTags.includes(hint))) {
    score += 1;
    reasons.push('household match');
  }
  if (profile.goals && icon.tags.some((tag) => profile.goals?.map(normalize).includes(tag))) {
    score += 1;
    reasons.push('goal support');
  }
  return { score, reasons };
}

function titleCase(input?: string | null): string | undefined {
  if (!input) return undefined;
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function composeBundleName(profile: MagnetBundleProfile, traits: string[]): string {
  const descriptors: string[] = [];
  const hd = humanDesignKeywords(profile.humanDesignType);
  if (hd.length) descriptors.push(hd[0].toUpperCase());
  const role = titleCase(profile.householdRole || profile.household);
  if (role) descriptors.push(role);
  const childTypes: string[] = [];
  for (const child of profile.children || []) {
    const hdHints = humanDesignKeywords(child.humanDesignType);
    if (hdHints.length) {
      childTypes.push(titleCase(hdHints[0]) || hdHints[0].toUpperCase());
    }
  }
  if (childTypes.length) descriptors.push(`${childTypes.join(' & ')} Kids`);
  const lifeType = titleCase(profile.lifeType);
  const prefix = lifeType ? `${lifeType} Rhythm` : 'Soul Rhythm Bundle';
  if (!descriptors.length) return prefix;
  return `${prefix} – ${descriptors.join(', ')}`;
}

async function readCache(): Promise<CacheEntry[]> {
  if (!hasNodeRuntime) return MEMORY_CACHE;
  if (MEMORY_CACHE.length) return MEMORY_CACHE;
  try {
    const fs = await ensureFs();
    const filePath = await ensureCachePath();
    if (!filePath) return MEMORY_CACHE;
    const raw = await fs.readFile(filePath, 'utf8').catch(() => '[]');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      MEMORY_CACHE.push(...(parsed as CacheEntry[]));
    }
  } catch (err) {
    console.warn('[magnet-bundle] unable to read cache file', err);
  }
  return MEMORY_CACHE;
}

async function writeCache(entries: CacheEntry[]): Promise<boolean> {
  MEMORY_CACHE.splice(0, MEMORY_CACHE.length, ...entries);
  if (!hasNodeRuntime) return false;
  try {
    const fs = await ensureFs();
    const filePath = await ensureCachePath();
    if (!filePath) return false;
    await fs.mkdir((await import('path')).dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('[magnet-bundle] failed to write cache file', err);
    return false;
  }
}

async function ensureBundleFolder(
  drive: drive_v3.Drive,
  opts: { driveFolderId?: string; env?: any }
): Promise<string | undefined> {
  if (opts.driveFolderId) return opts.driveFolderId;
  if (!hasNodeRuntime) return undefined;
  try {
    const mod = await import('../../src/fulfillment/common');
    if (typeof (mod as any).loadFulfillmentConfig === 'function' && typeof (mod as any).ensureFolder === 'function') {
      const config = await (mod as any).loadFulfillmentConfig(opts.env || {});
      if (config?.driveRootId) {
        const folder = await (mod as any).ensureFolder(drive, config.driveRootId, 'Soul Rhythm Bundles');
        return folder?.id;
      }
    }
  } catch (err) {
    console.warn('[magnet-bundle] unable to resolve fulfillment drive root', err);
  }
  return undefined;
}

function bundleToPersistable(bundle: GeneratedMagnetBundle): Record<string, any> {
  return {
    id: bundle.id,
    slug: bundle.slug,
    name: bundle.name,
    description: bundle.description,
    createdAt: bundle.createdAt,
    profile: bundle.profile,
    traits: bundle.traits,
    icons: bundle.icons,
    storage: bundle.storage,
    source: bundle.source,
  };
}

export async function persistMagnetBundle(
  bundle: GeneratedMagnetBundle,
  opts: GenerateMagnetBundleOptions,
): Promise<PersistResult> {
  if (opts.persist === false) {
    return { cacheUpdated: false };
  }
  let driveFileId: string | undefined;
  let driveFileUrl: string | undefined;
  let sheetRowAppended = false;
  let cacheUpdated = false;

  if (hasNodeRuntime) {
    try {
      const drive = await getDrive();
      const folderId = await ensureBundleFolder(drive, { driveFolderId: opts.driveFolderId, env: opts.env });
      const requestBody: drive_v3.Schema$File = {
        name: `${bundle.slug}.json`,
        mimeType: 'application/json',
        parents: folderId ? [folderId] : undefined,
      };
      const media = {
        mimeType: 'application/json',
        body: JSON.stringify(bundleToPersistable(bundle), null, 2),
      } as any;
      const res = await drive.files.create({
        requestBody,
        media,
        fields: 'id, webViewLink',
      });
      driveFileId = res.data.id || undefined;
      driveFileUrl = res.data.webViewLink || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : undefined);
    } catch (err) {
      console.warn('[magnet-bundle] failed to write bundle JSON to Drive', err);
    }

    try {
      const sheetId = opts.sheetId || process.env.MAGNET_BUNDLE_SHEET_ID;
      if (sheetId) {
        const sheets = await getSheets();
        const icons = bundle.icons.map((icon) => icon.label).join(', ');
        const traits = bundle.traits.join(', ');
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetId,
          range: 'MagnetBundle_Log!A2:H',
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              [
                bundle.createdAt,
                bundle.name,
                bundle.profile.name || '',
                bundle.profile.householdRole || bundle.profile.household || '',
                bundle.profile.humanDesignType || '',
                icons,
                traits,
                driveFileUrl || '',
              ],
            ],
          },
        });
        sheetRowAppended = true;
      }
    } catch (err) {
      console.warn('[magnet-bundle] failed to append sheet row', err);
    }
  }

  try {
    const existing = await readCache();
    const withoutCurrent = existing.filter((entry) => entry.id !== bundle.id);
    withoutCurrent.unshift({ ...bundle, storage: { ...bundle.storage, driveFileId, driveFileUrl, sheetRowAppended } });
    cacheUpdated = await writeCache(withoutCurrent);
  } catch (err) {
    console.warn('[magnet-bundle] failed to update cache', err);
  }

  return { driveFileId, driveFileUrl, sheetRowAppended, cacheUpdated };
}

function ensureHelperDirectives(bundle: GeneratedMagnetBundle, minIcons: number): HelperBotDirective[] {
  const helpers: HelperBotDirective[] = [...bundle.helpers];
  if (bundle.icons.length <= minIcons) {
    helpers.push({
      name: 'designer',
      instructions: `Bundle "${bundle.name}" only has ${bundle.icons.length} icons. Draft 3 additional concepts for traits: ${
        bundle.traits.join(', ') || 'core rhythm'
      }.`,
      payload: {
        traits: bundle.traits,
        currentIcons: bundle.icons.map((icon) => icon.label),
      },
    });
  }
  return helpers;
}

export async function generateMagnetBundle(
  profile: MagnetBundleProfile,
  opts: GenerateMagnetBundleOptions = {}
): Promise<GeneratedMagnetBundle> {
  const minIcons = opts.minIcons ?? 8;
  const createdAt = new Date().toISOString();
  const traits = collectTraitTags(profile);
  const iconLibrary = await loadIconLibrary();
  const libraryMap = new Map(iconLibrary.map((entry) => [entry.slug, entry]));

  const scored = ICON_DEFINITIONS.map((icon) => {
    const { score, reasons } = matchScore(profile, icon);
    return { icon, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const selected: MagnetBundleIcon[] = [];
  const usedKeys = new Set<string>();
  for (const { icon, score, reasons } of scored) {
    if (score <= 0) continue;
    if (usedKeys.has(icon.key)) continue;
    const library = libraryMap.get(icon.librarySlug);
    selected.push({
      slug: icon.key,
      label: icon.label,
      description: icon.description,
      tags: icon.tags,
      reasons,
      librarySlug: icon.librarySlug,
      libraryName: library?.name,
      driveFileId: library?.fileId,
      tone: library?.tone,
      ageRanges: library?.ageRanges,
    });
    usedKeys.add(icon.key);
    if (selected.length >= minIcons) break;
  }

  if (selected.length < minIcons) {
    for (const icon of ICON_DEFINITIONS) {
      if (selected.length >= minIcons) break;
      if (usedKeys.has(icon.key)) continue;
      const library = libraryMap.get(icon.librarySlug);
      selected.push({
        slug: icon.key,
        label: icon.label,
        description: icon.description,
        tags: icon.tags,
        reasons: ['baseline'],
        librarySlug: icon.librarySlug,
        libraryName: library?.name,
        driveFileId: library?.fileId,
        tone: library?.tone,
        ageRanges: library?.ageRanges,
      });
      usedKeys.add(icon.key);
    }
  }

  const slugBase = profile.customLabel || profile.name || profile.id || profile.householdRole || 'bundle';
  const slug = slugify(`${slugBase}-${traits.slice(0, 3).join('-') || 'rhythm'}`);
  const bundleName = composeBundleName(profile, traits);
  const descriptionParts: string[] = [];
  if (profile.lifeType) descriptionParts.push(`${titleCase(profile.lifeType)} flow`);
  if (profile.householdRole || profile.household) descriptionParts.push(titleCase(profile.householdRole || profile.household) || '');
  if (profile.humanDesignType) descriptionParts.push(`${profile.humanDesignType} nervous system`);
  if (!descriptionParts.length) descriptionParts.push('Custom rhythm bundle generated from intake data.');
  const description = descriptionParts.filter(Boolean).join(' • ');

  const bundle: GeneratedMagnetBundle = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    slug,
    name: bundleName,
    description,
    profile: {
      ...profile,
      requestedBy: opts.requestedBy || profile.requestedBy,
    },
    traits,
    icons: selected,
    helpers: [],
    createdAt,
    source: 'generated',
  };

  bundle.helpers = ensureHelperDirectives(bundle, minIcons);

  const persistResult = await persistMagnetBundle(bundle, { ...opts, persist: opts.persist ?? true });
  bundle.storage = persistResult;
  bundle.helpers = ensureHelperDirectives(bundle, minIcons);

  return bundle;
}

function matchesQuery(bundle: GeneratedMagnetBundle, query: MagnetBundleQuery): boolean {
  if (query.customFilter && !query.customFilter(bundle)) return false;
  if (query.name) {
    const needle = query.name.toLowerCase();
    if (!bundle.name.toLowerCase().includes(needle) && !(bundle.profile.name || '').toLowerCase().includes(needle)) {
      return false;
    }
  }
  if (query.household) {
    const needle = query.household.toLowerCase();
    const haystack = `${bundle.profile.household || ''} ${bundle.profile.householdRole || ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (query.profileId) {
    if ((bundle.profile.id || '').toLowerCase() !== query.profileId.toLowerCase()) return false;
  }
  if (query.humanDesignType) {
    const hd = (bundle.profile.humanDesignType || '').toLowerCase();
    if (!hd.includes(query.humanDesignType.toLowerCase())) return false;
  }
  if (query.trait) {
    const traits = Array.isArray(query.trait) ? query.trait : [query.trait];
    const lowered = traits.map((value) => value.toLowerCase());
    const bundleTraits = bundle.traits.join(' ').toLowerCase();
    if (!lowered.some((trait) => bundleTraits.includes(trait))) return false;
  }
  return true;
}

export async function findMagnetBundles(query: MagnetBundleQuery = {}): Promise<GeneratedMagnetBundle[]> {
  const cache = await readCache();
  return cache.filter((bundle) => matchesQuery(bundle, query));
}

export function rememberMagnetCategories(): Record<string, string[]> {
  return {
    wellness: ['water-intake', 'quiet-reset', 'sensory-den', 'body-break'],
    household: ['lunch-helper', 'meal-prep', 'weekend-reset', 'check-in-circle'],
    spiritual: ['temple-time', 'gratitude-glow', 'slow-morning'],
    family: ['play-cleanup', 'bedtime-star', 'field-trip', 'check-in-circle'],
    business: ['creative-time', 'outreach-pulse', 'hd-chart'],
  };
}

export async function recallMagnetBundleByTrait(trait: string): Promise<GeneratedMagnetBundle[]> {
  return findMagnetBundles({ trait });
}
