import path from 'path';
import { Buffer } from 'buffer';
import { promises as fs } from 'fs';
import { chatJSON } from '../../lib/ai';
import { slugify } from '../../utils/slugify';
import type { NormalizedIntake, FulfillmentWorkspace } from './types';
import { ensureFolder } from './common';
import {
  loadAdvancedEsotericConfig,
  resolveCohortFromIntake,
  getActiveSystems,
} from './advanced-esoteric';
import { appendRows } from '../../lib/google';
import type { MagnetFormat } from '../../lib/magnet-kit';

export type MagnetPersonaTag =
  | 'solo mom'
  | 'adhd support'
  | 'household'
  | 'family'
  | 'homeschool'
  | 'toddler'
  | 'neurodivergent child'
  | 'sensory'
  | 'calm'
  | 'premium'
  | 'full'
  | 'deep'
  | 'elder support'
  | 'caregiver'
  | 'partner'
  | 'wellness';

export interface BundleIconDefinition {
  slug: string;
  label: string;
  description: string;
  tags?: string[];
  tone?: 'bright' | 'soft' | 'earthy';
  age?: Array<'child' | 'teen' | 'adult' | 'elder'>;
  formats?: MagnetFormat[];
  /**
   * Optional label templates keyed by personalization value names (e.g. familyName).
   */
  templates?: Record<string, string>;
}

export interface BlankIconConfig {
  enabled?: boolean;
  count?: number;
  defaultCount?: number;
  minCount?: number;
  maxCount?: number;
}

export interface StoredMagnetBundle {
  id: string;
  name: string;
  category: string;
  description?: string;
  formats?: MagnetFormat[];
  personaTags?: MagnetPersonaTag[];
  keywords?: string[];
  icons: BundleIconDefinition[];
  includeBlanks?: BlankIconConfig;
  source?: 'stored' | 'generated';
}

export interface MagnetIconRequest {
  slug: string;
  label: string;
  description: string;
  tags: string[];
  tone: 'bright' | 'soft' | 'earthy';
}

export interface HelperBotTask {
  name: 'icon-formatter' | 'bundle-sorter';
  instructions: string;
  payload?: Record<string, any>;
}

export interface PersonalizationContext {
  familyName?: string;
  childName?: string;
  rhythmStyle?: string;
  cohort?: 'child' | 'teen' | 'adult' | 'elder';
  preferredFormat: MagnetFormat;
  personaTags: MagnetPersonaTag[];
  keywords: string[];
}

export interface MagnetBundlePlan {
  bundle: StoredMagnetBundle & { source: 'stored' | 'generated' | 'fallback'; };
  requests: MagnetIconRequest[];
  helpers: HelperBotTask[];
  personalization: PersonalizationContext;
  keywords: string[];
  format: MagnetFormat;
  source: 'stored' | 'generated' | 'fallback';
}

interface BundleModuleOptions {
  workspace?: FulfillmentWorkspace;
  staticPath?: string;
  runtimePath?: string;
  allowPersistence?: boolean;
}

const STATIC_BUNDLE_PATH = path.resolve(process.cwd(), 'config', 'magnet-bundles.json');
const RUNTIME_BUNDLE_PATH = path.resolve(process.cwd(), 'data', 'generated-magnet-bundles.json');

interface BundleStoreShape {
  bundles?: StoredMagnetBundle[];
}

interface RawStoredBundle extends Record<string, any> {
  include_blanks?: Record<string, any>;
  includeBlanks?: Record<string, any>;
}

function normalizeBlankConfig(config: any): BlankIconConfig | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const normalized: BlankIconConfig = {
    enabled: config.enabled !== false,
  };
  if (typeof config.count === 'number') normalized.count = config.count;
  if (typeof config.defaultCount === 'number') normalized.defaultCount = config.defaultCount;
  if (typeof config.default_count === 'number') normalized.defaultCount = config.default_count;
  if (typeof config.minCount === 'number') normalized.minCount = config.minCount;
  if (typeof config.min_count === 'number') normalized.minCount = config.min_count;
  if (typeof config.maxCount === 'number') normalized.maxCount = config.maxCount;
  if (typeof config.max_count === 'number') normalized.maxCount = config.max_count;
  return normalized;
}

function normalizeStoredBundle(bundle: RawStoredBundle): StoredMagnetBundle {
  const { include_blanks, includeBlanks, ...rest } = bundle || {};
  const normalized = { ...rest } as StoredMagnetBundle;
  const blanks = normalizeBlankConfig(includeBlanks ?? include_blanks);
  if (blanks) {
    normalized.includeBlanks = blanks;
  }
  return normalized;
}

function readField(data: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function collectKeywords(data: Record<string, any>): string[] {
  const keywords = new Set<string>();
  const stringKeys = [
    'focus',
    'themes',
    'routine_keywords',
    'magnet_keywords',
    'support_needs',
    'daily_blocks',
    'goals',
  ];
  for (const key of stringKeys) {
    const value = data?.[key];
    if (typeof value === 'string') {
      value
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((kw) => keywords.add(kw.toLowerCase()));
    }
    if (Array.isArray(value)) {
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .forEach((kw) => keywords.add(kw.toLowerCase()));
    }
  }
  return Array.from(keywords);
}

function detectPersonaTags(intake: NormalizedIntake): MagnetPersonaTag[] {
  const tags = new Set<MagnetPersonaTag>();
  const prefs = intake.prefs || {};
  const household = readField(prefs, ['household', 'household_type', 'family_structure', 'family']);
  const focus = readField(prefs, ['focus', 'themes', 'primary_need']);
  const diagnosis = readField(prefs, ['diagnosis', 'support_needs', 'child_needs']);
  const format = readField(prefs, ['format', 'magnet_format', 'preferred_format']);

  if (household) {
    const lower = household.toLowerCase();
    if (lower.includes('solo') || lower.includes('single')) tags.add('solo mom');
    if (lower.includes('family') || lower.includes('household')) tags.add('family');
    if (lower.includes('homeschool')) tags.add('homeschool');
    if (lower.includes('partner')) tags.add('partner');
    if (lower.includes('elder')) tags.add('elder support');
  }

  if (diagnosis) {
    const lower = diagnosis.toLowerCase();
    if (lower.includes('adhd')) tags.add('adhd support');
    if (lower.includes('autis') || lower.includes('asd') || lower.includes('neuro')) tags.add('neurodivergent child');
    if (lower.includes('sensory')) tags.add('sensory');
  }

  if (focus) {
    const lower = focus.toLowerCase();
    if (lower.includes('wellness') || lower.includes('regulation')) tags.add('wellness');
    if (lower.includes('deep') || lower.includes('premium')) tags.add('premium');
    if (lower.includes('full')) tags.add('full');
  }

  if (format && /cling|vinyl/.test(format.toLowerCase())) {
    tags.add('household');
  }

  if (intake.tier === 'full') {
    tags.add('premium');
    tags.add('full');
  }

  if (intake.ageCohort === 'child') tags.add('toddler');

  return Array.from(tags);
}

function resolvePreferredFormat(intake: NormalizedIntake): MagnetFormat {
  const prefs = intake.prefs || {};
  const format = readField(prefs, ['format', 'magnet_format', 'preferred_format', 'output_style']);
  if (format) {
    const lower = format.toLowerCase();
    if (lower.includes('print')) return 'printable';
    if (lower.includes('vinyl') || lower.includes('whiteboard')) return 'vinyl';
    if (lower.includes('cling')) return 'cling';
    if (lower.includes('svg')) return 'svg';
    if (lower.includes('digital')) return 'digital';
  }
  return 'svg';
}

function resolvePreferredCategory(intake: NormalizedIntake, personaTags: MagnetPersonaTag[], keywords: string[]): string | undefined {
  const prefs = intake.prefs || {};
  const category = readField(prefs, ['bundle_category', 'category', 'preferred_category']);
  if (category) return category;
  if (personaTags.includes('wellness') || keywords.some((kw) => kw.includes('regulation'))) return 'Wellness';
  if (personaTags.includes('family') || personaTags.includes('homeschool')) return 'Family';
  if (personaTags.includes('premium')) return 'Complete All-in-One';
  return undefined;
}

async function loadBundles(opts: BundleModuleOptions = {}): Promise<StoredMagnetBundle[]> {
  const staticPath = opts.staticPath || STATIC_BUNDLE_PATH;
  const runtimePath = opts.runtimePath || RUNTIME_BUNDLE_PATH;
  let staticBundles: StoredMagnetBundle[] = [];
  let runtimeBundles: StoredMagnetBundle[] = [];

  try {
    const raw = await fs.readFile(staticPath, 'utf8');
    const parsed: BundleStoreShape = JSON.parse(raw || '{}');
    const rawBundles = Array.isArray(parsed.bundles) ? parsed.bundles : [];
    staticBundles = rawBundles.map((bundle) => normalizeStoredBundle({ ...bundle, source: 'stored' }));
  } catch (err) {
    console.warn('[magnet-bundles] failed to read static bundle store:', err);
  }

  try {
    const raw = await fs.readFile(runtimePath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    const rawBundles = Array.isArray(parsed) ? parsed : parsed.bundles || [];
    runtimeBundles = rawBundles.map((bundle: RawStoredBundle) =>
      normalizeStoredBundle({ ...bundle, source: bundle.source || 'generated' })
    );
  } catch (err) {
    // runtime store optional
  }

  return [...staticBundles, ...runtimeBundles];
}

async function saveGeneratedBundle(bundle: StoredMagnetBundle, opts: BundleModuleOptions = {}): Promise<void> {
  if (opts.allowPersistence === false) return;
  const runtimePath = opts.runtimePath || RUNTIME_BUNDLE_PATH;
  try {
    await fs.mkdir(path.dirname(runtimePath), { recursive: true });
    let existing: StoredMagnetBundle[] = [];
    try {
      const raw = await fs.readFile(runtimePath, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      existing = Array.isArray(parsed) ? parsed : parsed.bundles || [];
    } catch (err) {
      existing = [];
    }
    const withoutDuplicate = existing.filter((item) => item.id !== bundle.id && item.name !== bundle.name);
    withoutDuplicate.push({ ...bundle, source: 'generated' });
    await fs.writeFile(runtimePath, JSON.stringify(withoutDuplicate, null, 2));
  } catch (err) {
    console.warn('[magnet-bundles] unable to persist generated bundle:', err);
  }
}

function scoreBundle(
  bundle: StoredMagnetBundle,
  preferredCategory: string | undefined,
  personaTags: MagnetPersonaTag[],
  keywords: string[],
  preferredFormat: MagnetFormat
): number {
  let score = 0;
  if (preferredCategory && bundle.category.toLowerCase() === preferredCategory.toLowerCase()) score += 6;
  if (bundle.formats?.includes(preferredFormat)) score += 2;
  const tagMatches = personaTags.filter((tag) => bundle.personaTags?.includes(tag)).length;
  score += tagMatches * 2;
  const keywordMatches = keywords.filter((kw) => bundle.keywords?.some((k) => k.toLowerCase() === kw.toLowerCase())).length;
  score += keywordMatches;
  return score;
}

function applyPersonalization(
  icon: BundleIconDefinition,
  personalization: PersonalizationContext
): BundleIconDefinition {
  const clone = { ...icon };
  if (icon.templates) {
    for (const [key, template] of Object.entries(icon.templates)) {
      const value = (personalization as any)[key];
      if (typeof value === 'string' && value.trim()) {
        clone.label = template.replace('{value}', value.trim());
      }
    }
  }
  if (personalization.childName && /child|kid|toddler/i.test(icon.label)) {
    clone.label = icon.label.replace(/child|kid|toddler/gi, personalization.childName.split(' ')[0]);
  }
  if (personalization.familyName) {
    if (/family|household|circle/i.test(icon.label)) {
      clone.label = `${personalization.familyName} ${icon.label.replace(/family|household/gi, '').trim()}`.trim();
    } else if (
      (personalization.personaTags.includes('solo mom') || personalization.personaTags.includes('family')) &&
      !clone.label.toLowerCase().includes(personalization.familyName.toLowerCase())
    ) {
      clone.label = `${personalization.familyName} ${clone.label}`.trim();
    }
  }
  return clone;
}

function buildHelperTasks(plan: {
  format: MagnetFormat;
  personaTags: MagnetPersonaTag[];
  keywords: string[];
  bundleName: string;
  iconCount: number;
}): HelperBotTask[] {
  const helpers: HelperBotTask[] = [];
  helpers.push({
    name: 'bundle-sorter',
    instructions: `Tag ${plan.iconCount} icons for ${plan.bundleName} with persona keywords ${plan.personaTags.join(', ') || 'general'}.`,
    payload: { keywords: plan.keywords, personaTags: plan.personaTags },
  });
  if (plan.format === 'svg' || plan.format === 'svg-sheet') {
    helpers.push({
      name: 'icon-formatter',
      instructions: 'Prepare Cricut-ready SVG sheet (12x12) with bleed-safe margins and 0.125in spacing.',
      payload: { format: plan.format },
    });
  } else if (plan.format === 'printable' || plan.format === 'pdf') {
    helpers.push({
      name: 'icon-formatter',
      instructions: 'Lay out printable PDF sheet in US Letter and A4 with crop marks and bundle title header.',
      payload: { format: plan.format },
    });
  }
  return helpers;
}

function iconMatchesAudience(icon: BundleIconDefinition, personalization: PersonalizationContext): boolean {
  if (!icon.age?.length) return true;
  if (!personalization.cohort) return true;
  return icon.age.includes(personalization.cohort);
}

function toRequests(
  bundle: StoredMagnetBundle,
  personalization: PersonalizationContext
): MagnetIconRequest[] {
  return bundle.icons
    .map((icon) => applyPersonalization(icon, personalization))
    .filter((icon) => iconMatchesAudience(icon, personalization))
    .map((icon) => ({
      slug: icon.slug,
      label: icon.label,
      description: icon.description,
      tags: icon.tags || [],
      tone: icon.tone || 'soft',
    }));
}

export function buildFallbackIconRequests(intake: NormalizedIntake): MagnetIconRequest[] {
  const toneRaw = (intake.prefs?.tone || '').toLowerCase();
  const baseTone: MagnetIconRequest['tone'] = toneRaw.includes('earth')
    ? 'earthy'
    : toneRaw.includes('bold')
    ? 'bright'
    : 'soft';

  const requests: MagnetIconRequest[] = [
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function buildBlankIconRequests(config?: BlankIconConfig): MagnetIconRequest[] {
  if (config?.enabled === false) return [];
  const min = typeof config?.minCount === 'number' ? Math.max(0, Math.floor(config.minCount)) : 2;
  const maxBase = typeof config?.maxCount === 'number' ? Math.max(min, Math.floor(config.maxCount)) : 10;
  const max = maxBase > 10 ? 10 : maxBase;
  const hasExplicitCount = typeof config?.count === 'number';
  const desired = hasExplicitCount
    ? Math.floor(config!.count!)
    : Math.floor(config?.defaultCount ?? (min > 3 ? min : 3));
  const bounded = hasExplicitCount ? clamp(desired, 0, max) : clamp(Math.max(desired, min), min, max);
  if (bounded <= 0) return [];
  const count = bounded;
  const requests: MagnetIconRequest[] = [];
  for (let i = 1; i <= count; i += 1) {
    const multiple = count > 1;
    requests.push({
      slug: multiple ? `blank-fill-in-${i}` : 'blank-fill-in',
      label: multiple ? `Write Your Own ${i}` : 'Write Your Own',
      description: 'Intentionally blank magnet so you can add your own routine or reminder.',
      tags: ['blank', 'custom'],
      tone: 'soft',
    });
  }
  return requests;
}

async function generateBundleWithAI(
  intake: NormalizedIntake,
  personalization: PersonalizationContext,
  opts: BundleModuleOptions
): Promise<StoredMagnetBundle | null> {
  try {
    const personaSummary = personalization.personaTags.join(', ') || 'general household';
    const promptInput = {
      personaSummary,
      keywords: personalization.keywords,
      preferredFormat: personalization.preferredFormat,
      cohort: personalization.cohort,
      tier: intake.tier,
      goals: collectKeywords(intake.prefs || {}),
    };
    const system = `You are Maggie the icon librarian. Create tailored magnet bundles that feel cozy, spiritual, and regulated.`;
    const user = `Generate a magnet icon bundle as JSON with fields {"name","category","description","icons":[{"slug","label","description","tags","tone"}],"keywords"}. Persona tags: ${personaSummary}. Keywords: ${personalization.keywords.join(', ')}. Preferred format: ${personalization.preferredFormat}.`;
    const response = await chatJSON<{ name: string; category: string; description: string; icons: BundleIconDefinition[]; keywords?: string[] }>(
      system,
      `${user}\nRaw context:${JSON.stringify(promptInput)}`,
      { temperature: 0.3, openaiModel: 'gpt-4.1-mini' }
    );
    if (!response?.icons?.length) return null;
    const name = response.name?.trim() || `${personalization.personaTags[0] || 'Custom'} Rhythm`;
    const id = `generated-${slugify(`${name}-${Date.now()}`)}`;
    const bundle: StoredMagnetBundle = {
      id,
      name,
      category: response.category?.trim() || 'Custom',
      description: response.description?.trim() || '',
      formats: [personalization.preferredFormat, 'svg', 'digital'],
      personaTags: personalization.personaTags,
      keywords: response.keywords && response.keywords.length ? response.keywords : personalization.keywords,
      icons: response.icons.map((icon) => ({
        slug: icon.slug || slugify(icon.label || 'icon'),
        label: icon.label?.trim() || 'Custom Icon',
        description: icon.description?.trim() || '',
        tags: icon.tags || [],
        tone: icon.tone || 'soft',
      })),
      source: 'generated',
    };
    await saveGeneratedBundle(bundle, opts);
    return bundle;
  } catch (err) {
    console.warn('[magnet-bundles] AI generation failed, falling back:', err);
    return null;
  }
}

function buildPersonalization(intake: NormalizedIntake): PersonalizationContext {
  const personaTags = detectPersonaTags(intake);
  const keywords = collectKeywords(intake.prefs || {});
  const preferredFormat = resolvePreferredFormat(intake);
  const familyName = readField(intake.prefs || {}, ['family_name', 'last_name', 'household_name']) || intake.customer?.lastName;
  const childName = readField(intake.prefs || {}, ['child_name', 'kid_name', 'recipient_name']);
  const rhythmStyle = readField(intake.prefs || {}, ['rhythm_style', 'energy_style', 'vibe']);
  return {
    familyName,
    childName,
    rhythmStyle,
    cohort: intake.ageCohort,
    preferredFormat,
    personaTags,
    keywords,
  };
}

export async function resolveMagnetBundlePlan(
  intake: NormalizedIntake,
  opts: BundleModuleOptions = {}
): Promise<MagnetBundlePlan> {
  const personalization = buildPersonalization(intake);
  const bundles = await loadBundles(opts);
  const preferredCategory = resolvePreferredCategory(intake, personalization.personaTags, personalization.keywords);
  let best: StoredMagnetBundle | null = null;
  let bestScore = 0;
  for (const bundle of bundles) {
    const score = scoreBundle(bundle, preferredCategory, personalization.personaTags, personalization.keywords, personalization.preferredFormat);
    if (score > bestScore) {
      best = bundle;
      bestScore = score;
    }
  }

  let source: MagnetBundlePlan['source'] = 'stored';
  if (!best || bestScore < 4) {
    const generated = await generateBundleWithAI(intake, personalization, opts);
    if (generated) {
      best = generated;
      source = 'generated';
      bestScore = 10;
    } else if (!best || bestScore < 4) {
      best = null;
    }
  }

  if (!best) {
    const fallbackIcons = buildFallbackIconRequests(intake);
    const bundle: StoredMagnetBundle = {
      id: 'fallback-bundle',
      name: 'Fallback Rhythm Icons',
      category: preferredCategory || 'Household',
      description: 'Baseline icons assembled when no bundle match is found.',
      icons: fallbackIcons.map((icon) => ({
        slug: icon.slug,
        label: icon.label,
        description: icon.description,
        tags: icon.tags,
        tone: icon.tone,
      })),
      personaTags: personalization.personaTags,
      keywords: personalization.keywords,
      formats: [personalization.preferredFormat, 'svg'],
      includeBlanks: { enabled: true },
      source: 'stored',
    };
    best = bundle;
    source = 'fallback';
    bestScore = 5;
  }

  const iconRequests = toRequests(best, personalization);
  const blankRequests = buildBlankIconRequests(best.includeBlanks);
  const combinedRequests = [...iconRequests, ...blankRequests];
  const fallbackWithBlanks = [
    ...buildFallbackIconRequests(intake),
    ...(!iconRequests.length ? buildBlankIconRequests(best.includeBlanks) : []),
  ];
  const requests = combinedRequests.length ? combinedRequests : fallbackWithBlanks;
  const format = personalization.preferredFormat;
  const helpers = buildHelperTasks({
    format,
    personaTags: personalization.personaTags,
    keywords: personalization.keywords,
    bundleName: best.name,
    iconCount: requests.length,
  });

  return {
    bundle: { ...best, source },
    requests,
    helpers,
    personalization,
    keywords: personalization.keywords,
    format,
    source,
  };
}

export async function persistBundlePlanArtifacts(
  plan: MagnetBundlePlan,
  icons: Array<{ fileId: string; origin: string }>,
  manifest: Record<string, any>,
  workspace?: FulfillmentWorkspace
): Promise<void> {
  if (!workspace || plan.source !== 'generated') return;
  const drive = workspace.drive;
  try {
    const root = workspace.config.iconLibraryFolderId || workspace.rootFolderId;
    const libraryRoot = await ensureFolder(drive, root, 'Magnet Bundles');
    const folderName = `${plan.bundle.category} - ${plan.bundle.name}`.substring(0, 80);
    const bundleFolder = await ensureFolder(drive, libraryRoot.id!, folderName);

    for (const icon of icons) {
      if (!icon.fileId) continue;
      try {
        await drive.files.copy({
          fileId: icon.fileId,
          requestBody: {
            name: `library-${icon.fileId}.svg`,
            parents: [bundleFolder.id!],
          },
        });
      } catch (err) {
        console.warn('[magnet-bundles] failed to copy icon into library:', err);
      }
    }

    try {
      await drive.files.create({
        requestBody: {
          name: 'manifest.json',
          mimeType: 'application/json',
          parents: [bundleFolder.id!],
        },
        media: { mimeType: 'application/json', body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      });
    } catch (err) {
      console.warn('[magnet-bundles] failed to store manifest:', err);
    }

    if (workspace.config.sheetId) {
      try {
        await appendRows(workspace.config.sheetId, 'MagnetBundles!A2:G', [
          [
            new Date().toISOString(),
            plan.bundle.name,
            plan.bundle.category,
            plan.personalization.familyName || '',
            plan.keywords.join(', '),
            plan.personalization.preferredFormat,
            bundleFolder.webViewLink || '',
          ],
        ]);
      } catch (err) {
        console.warn('[magnet-bundles] failed to log bundle to sheet:', err);
      }
    }

    const notionDb = process.env.MAGNET_BUNDLE_NOTION_DB_ID || workspace.config.notionDatabaseId;
    const notionToken = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
    if (notionDb && notionToken) {
      try {
        const { Client } = await import('@notionhq/client');
        const notion = new Client({ auth: notionToken });
        await notion.pages.create({
          parent: { database_id: notionDb },
          properties: {
            Name: { title: [{ text: { content: plan.bundle.name } }] },
            Category: { select: { name: plan.bundle.category } },
            Keywords: { rich_text: [{ text: { content: plan.keywords.join(', ') } }] },
            Format: { rich_text: [{ text: { content: plan.format } }] },
            Folder: { url: bundleFolder.webViewLink || '' },
            Source: { select: { name: plan.source } },
          },
        });
      } catch (err) {
        console.warn('[magnet-bundles] failed to log bundle to notion:', err);
      }
    }
  } catch (err) {
    console.warn('[magnet-bundles] unable to persist generated bundle artifacts:', err);
  }
}
