import path from 'path';
import { Buffer } from 'buffer';
import { promises as fs } from 'fs';
import { chatJSON } from '../../lib/ai';
import { slugify } from '../../utils/slugify';
import type { NormalizedIntake, FulfillmentWorkspace, IconAudienceProfile, IconStyleLevel } from './types';
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

export interface StoredMagnetBundle {
  id: string;
  name: string;
  category: string;
  description?: string;
  formats?: MagnetFormat[];
  personaTags?: MagnetPersonaTag[];
  keywords?: string[];
  icons: BundleIconDefinition[];
  iconSize?: string;
  styleLevel?: IconStyleLevel;
  source?: 'stored' | 'generated' | 'fallback';
}

export interface MagnetIconRequest {
  slug: string;
  label: string;
  description: string;
  tags: string[];
  tone: 'bright' | 'soft' | 'earthy';
  iconSize?: string;
  styleLevel?: IconStyleLevel;
  highContrast?: boolean;
  emphasizeCategories?: boolean;
  audienceName?: string;
  category?: string;
  creativeTone?: boolean;
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
  styleLevel: IconStyleLevel;
  iconSize: string;
  simplifyText: boolean;
  highContrast: boolean;
  needsRepetition: boolean;
  emphasizeCategories: boolean;
  creativeTone?: boolean;
  primaryAudienceName?: string;
  audiences: IconAudienceProfile[];
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

function normalizeStyleLevel(raw: any): IconStyleLevel | undefined {
  if (!raw) return undefined;
  const value = String(raw).toLowerCase();
  if (value.includes('kid')) return 'kid_friendly';
  if (value.includes('elder')) return 'elder_accessible';
  if (value.includes('neuro') || value.includes('sensory')) return 'neurodivergent_support';
  if (value.includes('standard')) return 'standard';
  return undefined;
}

function defaultIconSizeForStyle(style?: IconStyleLevel): string {
  switch (style) {
    case 'kid_friendly':
    case 'elder_accessible':
      return '1.25in';
    case 'neurodivergent_support':
      return '1.1in';
    default:
      return '0.95in';
  }
}

function parseIconSize(value?: string): number | null {
  if (!value) return null;
  const match = String(value).match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const parsed = parseFloat(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function resolveAudienceVersion(map: Record<string, any> | undefined, name: string): number {
  if (!map) return 1;
  const normalizedName = name.toLowerCase();
  const sanitized = normalizedName.replace(/[^a-z0-9]/g, '');
  const raw = map[normalizedName] ?? map[sanitized] ?? map[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

interface AudienceProfileOptions {
  baseCohort?: 'child' | 'teen' | 'adult' | 'elder';
  personaTags: MagnetPersonaTag[];
  defaultStyle: IconStyleLevel;
  defaultIconSize?: string;
  versionMap?: Record<string, any>;
  keywords: string[];
}

function createAudienceProfile(name: string | undefined, opts: AudienceProfileOptions): IconAudienceProfile {
  const safeName = (name || 'Primary').trim() || 'Primary';
  const normalized = safeName.toLowerCase();
  let cohort = opts.baseCohort || 'adult';

  if (opts.personaTags.includes('toddler')) cohort = 'child';
  if (opts.personaTags.includes('elder support')) cohort = 'elder';

  if (normalized === 'cairo') cohort = 'child';
  if (normalized === 'enzo') cohort = 'elder';
  if (normalized === 'chanel') cohort = 'adult';

  const keywordCohort = opts.keywords.find((kw) => kw.includes('kid') || kw.includes('child'));
  if (keywordCohort && cohort === 'adult') cohort = 'child';
  const keywordElder = opts.keywords.find((kw) => kw.includes('elder') || kw.includes('grand'));
  if (keywordElder) cohort = 'elder';

  let styleLevel: IconStyleLevel = opts.defaultStyle;
  if (cohort === 'child') styleLevel = 'kid_friendly';
  if (cohort === 'elder') styleLevel = 'elder_accessible';

  let simplifyText = styleLevel === 'kid_friendly';
  let highContrast = styleLevel === 'elder_accessible';
  let needsRepetition = false;
  let emphasizeCategories = styleLevel === 'neurodivergent_support';
  let creativeTone = normalized === 'chanel';

  if (normalized === 'cairo') {
    styleLevel = 'kid_friendly';
    simplifyText = true;
  }

  if (normalized === 'enzo') {
    styleLevel = 'elder_accessible';
    highContrast = true;
    simplifyText = true;
    needsRepetition = true;
  }

  if (opts.personaTags.includes('neurodivergent child') || opts.personaTags.includes('sensory')) {
    needsRepetition = true;
    emphasizeCategories = true;
    if (styleLevel === 'standard') styleLevel = 'neurodivergent_support';
  }

  if (opts.personaTags.includes('adhd support')) {
    needsRepetition = true;
    emphasizeCategories = true;
  }

  if (opts.keywords.some((kw) => kw.includes('creative') || kw.includes('design') || kw.includes('art'))) {
    creativeTone = true;
  }

  if (styleLevel === 'kid_friendly' || styleLevel === 'elder_accessible') {
    simplifyText = true;
  }

  const baseIconSize = typeof opts.defaultIconSize === 'string' && opts.defaultIconSize.trim() ? opts.defaultIconSize.trim() : defaultIconSizeForStyle(opts.defaultStyle);
  let iconSize = baseIconSize || defaultIconSizeForStyle(styleLevel);
  if (styleLevel === 'kid_friendly' || styleLevel === 'elder_accessible') {
    iconSize = '1.25in';
  } else if (styleLevel === 'neurodivergent_support') {
    iconSize = iconSize || '1.1in';
  }

  if (!emphasizeCategories && needsRepetition) {
    emphasizeCategories = true;
  }

  const version = resolveAudienceVersion(opts.versionMap, safeName);

  return {
    name: safeName,
    cohort,
    iconSize,
    styleLevel,
    simplifyText,
    highContrast,
    needsRepetition,
    emphasizeCategories,
    creativeTone: creativeTone || undefined,
    version,
  };
}

function normalizeBundle(bundle: any, source: StoredMagnetBundle['source']): StoredMagnetBundle {
  const iconSize =
    (typeof bundle?.iconSize === 'string' && bundle.iconSize.trim()) ||
    (typeof bundle?.icon_size === 'string' && bundle.icon_size.trim()) ||
    undefined;
  const styleLevel = normalizeStyleLevel(bundle?.styleLevel || bundle?.style_level);
  const icons = Array.isArray(bundle?.icons) ? bundle.icons.map((icon: BundleIconDefinition) => ({ ...icon })) : [];
  const normalized: StoredMagnetBundle = {
    ...(bundle as StoredMagnetBundle),
    iconSize,
    styleLevel: styleLevel || bundle?.styleLevel,
    icons,
    source,
  };
  delete (normalized as any).icon_size;
  delete (normalized as any).style_level;
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
    const stored = Array.isArray(parsed.bundles) ? parsed.bundles : [];
    staticBundles = stored.map((bundle) => normalizeBundle(bundle, 'stored'));
  } catch (err) {
    console.warn('[magnet-bundles] failed to read static bundle store:', err);
  }

  try {
    const raw = await fs.readFile(runtimePath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    runtimeBundles = (Array.isArray(parsed) ? parsed : parsed.bundles || []).map((bundle) =>
      normalizeBundle(bundle, (bundle?.source as StoredMagnetBundle['source']) || 'generated')
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
  personalization: PersonalizationContext
): {
  score: number;
  tagMatches: number;
  keywordMatches: number;
  styleMatched: boolean;
  formatMatched: boolean;
  sizeAligned: boolean;
} {
  let score = 0;
  if (preferredCategory && bundle.category.toLowerCase() === preferredCategory.toLowerCase()) score += 6;
  const formatMatched = bundle.formats?.includes(personalization.preferredFormat) ?? false;
  if (formatMatched) score += 1;
  const tagMatches = personalization.personaTags.filter((tag) => bundle.personaTags?.includes(tag)).length;
  score += tagMatches * 2;
  const keywordMatches = personalization.keywords.filter((kw) =>
    bundle.keywords?.some((k) => k.toLowerCase() === kw.toLowerCase())
  ).length;
  score += keywordMatches;
  const bundleStyle = normalizeStyleLevel(bundle.styleLevel);
  let styleMatched = false;
  if (bundleStyle && bundleStyle === personalization.styleLevel) {
    styleMatched = true;
    score += 2;
  } else if (bundleStyle && bundleStyle !== personalization.styleLevel) {
    score -= 1;
  }
  const bundleSize = parseIconSize(bundle.iconSize);
  const targetSize = parseIconSize(personalization.iconSize);
  let sizeAligned = false;
  if (bundleSize !== null && targetSize !== null) {
    const diff = Math.abs(bundleSize - targetSize);
    if (diff < 0.05) {
      score += 2;
      sizeAligned = true;
    } else if (diff < 0.15) {
      score += 1;
      sizeAligned = true;
    } else if (diff > 0.3) {
      score -= 1;
    }
  }
  if (personalization.needsRepetition && bundleStyle === 'neurodivergent_support') {
    score += 1;
  }
  return { score, tagMatches, keywordMatches, styleMatched, formatMatched, sizeAligned };
}

type PersonalizedIconDefinition = BundleIconDefinition & {
  iconSize?: string;
  styleLevel?: IconStyleLevel;
  audienceName?: string;
  needsRepetition?: boolean;
  highContrast?: boolean;
};

function simplifyLabelForAudience(label: string): string {
  if (!label) return label;
  const cleaned = label.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  if (words.length <= 1) return cleaned;
  const skipWords = new Set(['the', 'and', 'for', 'with', 'your']);
  const first = words[0];
  const second = words[1];
  const keepSecond = second && second.length <= 4 && !skipWords.has(second.toLowerCase());
  const simplified = keepSecond ? `${first} ${second}` : first;
  return simplified.charAt(0).toUpperCase() + simplified.slice(1);
}

function simplifyDescriptionForAudience(description: string): string {
  if (!description) return description;
  const firstSentence = description.split(/(?<=[.!?])\s+/)[0] || description;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  if (words.length <= 16) return firstSentence.trim();
  return `${words.slice(0, 16).join(' ')}…`;
}

function ensureHighContrastDescription(description: string): string {
  const note = 'High-contrast text and bold outlines for visibility.';
  if (!description) return note;
  if (description.toLowerCase().includes('high-contrast')) return description;
  return `${description.trim()} ${note}`.trim();
}

function ensureCategoryDescriptor(description: string, category: string): string {
  if (!category) return description;
  const prefix = `Category: ${category}.`;
  if (!description) return prefix;
  if (description.toLowerCase().includes(`category: ${category.toLowerCase()}`)) return description;
  return `${prefix} ${description}`.trim();
}

function ensureRepeatCueDescription(description: string, label: string): string {
  const note = `Repeat cue: ${label}.`;
  if (!description) return note;
  if (description.toLowerCase().includes('repeat cue')) return description;
  return `${description.trim()} ${note}`.trim();
}

function addStyleTag(tags: string[] = [], style: IconStyleLevel): string[] {
  const tagMap: Record<IconStyleLevel, string> = {
    kid_friendly: 'kid-friendly',
    elder_accessible: 'elder-accessible',
    standard: 'standard-style',
    neurodivergent_support: 'sensory-support',
  };
  const next = new Set(tags.map((tag) => tag.toLowerCase()));
  next.add(tagMap[style]);
  return Array.from(next);
}

function applyPersonalization(
  icon: BundleIconDefinition,
  personalization: PersonalizationContext,
  bundle: StoredMagnetBundle
): PersonalizedIconDefinition {
  const clone: PersonalizedIconDefinition = { ...icon, tags: [...(icon.tags || [])] };
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

  if (personalization.simplifyText) {
    clone.label = simplifyLabelForAudience(clone.label);
    clone.description = simplifyDescriptionForAudience(clone.description);
  }

  if (personalization.creativeTone) {
    clone.tags = [...new Set([...(clone.tags || []), 'creative'])];
  }

  if (personalization.highContrast) {
    clone.description = ensureHighContrastDescription(clone.description);
  }

  if (personalization.emphasizeCategories) {
    clone.description = ensureCategoryDescriptor(clone.description, bundle.category);
  }

  if (personalization.needsRepetition) {
    clone.description = ensureRepeatCueDescription(clone.description, clone.label);
    clone.tags = [...new Set([...(clone.tags || []), 'repeat'])];
  }

  if (personalization.styleLevel === 'kid_friendly' && clone.tone !== 'bright') {
    clone.tone = 'bright';
  }
  if (personalization.styleLevel === 'elder_accessible' && clone.tone === 'bright') {
    clone.tone = 'soft';
  }

  clone.iconSize = personalization.iconSize;
  clone.styleLevel = personalization.styleLevel;
  clone.audienceName = personalization.primaryAudienceName;
  clone.needsRepetition = personalization.needsRepetition;
  clone.highContrast = personalization.highContrast;
  clone.tags = addStyleTag(clone.tags, personalization.styleLevel);

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
    .map((icon) => applyPersonalization(icon, personalization, bundle))
    .filter((icon) => iconMatchesAudience(icon, personalization))
    .map((icon) => ({
      slug: icon.slug,
      label: icon.label,
      description: icon.description,
      tags: icon.tags || [],
      tone: icon.tone || 'soft',
      iconSize: icon.iconSize || personalization.iconSize,
      styleLevel: icon.styleLevel || personalization.styleLevel,
      highContrast: icon.highContrast || personalization.highContrast,
      emphasizeCategories: personalization.emphasizeCategories,
      audienceName: icon.audienceName,
      category: bundle.category,
      creativeTone: personalization.creativeTone,
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

function createFallbackBundle(
  intake: NormalizedIntake,
  personalization: PersonalizationContext,
  category: string | undefined
): StoredMagnetBundle {
  const fallbackIcons = buildFallbackIconRequests(intake);
  return {
    id: 'fallback-bundle',
    name: 'Fallback Rhythm Icons',
    category: category || 'Household',
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
    iconSize: personalization.iconSize,
    styleLevel: personalization.styleLevel,
    source: 'stored',
  };
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
      iconSize: personalization.iconSize,
      styleLevel: personalization.styleLevel,
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
  const defaultStyle =
    normalizeStyleLevel(readField(intake.prefs || {}, ['style_level', 'magnet_style'])) ||
    (intake.ageCohort === 'child'
      ? 'kid_friendly'
      : intake.ageCohort === 'elder'
      ? 'elder_accessible'
      : 'standard');
  const defaultIconSize =
    readField(intake.prefs || {}, ['icon_size', 'magnet_icon_size']) || defaultIconSizeForStyle(defaultStyle);
  const versionMap = (intake.prefs?.magnet_versions || intake.prefs?.icon_versions || intake.prefs?.versions) as
    | Record<string, any>
    | undefined;

  const names: string[] = [];
  const primaryCandidate =
    intake.customer?.firstName ||
    (intake.customer?.name ? intake.customer.name.split(' ')[0] : '') ||
    childName ||
    '';
  if (primaryCandidate?.trim()) names.push(primaryCandidate.trim());
  if (childName?.trim() && !names.includes(childName.trim())) names.push(childName.trim());
  const householdMembers = Array.isArray(intake.customer?.householdMembers) ? intake.customer?.householdMembers : [];
  for (const member of householdMembers) {
    if (typeof member === 'string' && member.trim() && !names.includes(member.trim())) {
      names.push(member.trim());
    }
  }
  const prefMembers = readField(intake.prefs || {}, ['household_members', 'magnet_people']);
  if (prefMembers) {
    prefMembers
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((name) => {
        if (!names.includes(name)) names.push(name);
      });
  }
  const readingName = (intake.raw as any)?.reading?.name || (intake.raw as any)?.reading?.primaryPerson;
  if (typeof readingName === 'string' && readingName.trim() && !names.includes(readingName.trim())) {
    names.push(readingName.trim());
  }
  if (!names.length) names.push('Primary');

  const audiences = names.map((name, index) =>
    createAudienceProfile(name, {
      baseCohort: index === 0 ? intake.ageCohort : undefined,
      personaTags,
      defaultStyle,
      defaultIconSize,
      versionMap,
      keywords,
    })
  );

  const primary = audiences[0] ||
    createAudienceProfile('Primary', {
      baseCohort: intake.ageCohort,
      personaTags,
      defaultStyle,
      defaultIconSize,
      versionMap,
      keywords,
    });

  return {
    familyName,
    childName,
    rhythmStyle,
    cohort: primary.cohort,
    preferredFormat,
    personaTags,
    keywords,
    styleLevel: primary.styleLevel,
    iconSize: primary.iconSize,
    simplifyText: primary.simplifyText,
    highContrast: primary.highContrast,
    needsRepetition: primary.needsRepetition,
    emphasizeCategories: primary.emphasizeCategories,
    creativeTone: primary.creativeTone,
    primaryAudienceName: primary.name,
    audiences,
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
  let bestMeta: ReturnType<typeof scoreBundle> | null = null;
  for (const bundle of bundles) {
    const bundleScore = scoreBundle(bundle, preferredCategory, personalization);
    if (bundleScore.score > bestScore) {
      best = bundle;
      bestScore = bundleScore.score;
      bestMeta = bundleScore;
    }
  }

  let source: MagnetBundlePlan['source'] = 'stored';
  const hasMeaningfulMatch =
    !!bestMeta &&
    (bestMeta.tagMatches > 0 ||
      bestMeta.keywordMatches > 0 ||
      (bestMeta.styleMatched && bestMeta.formatMatched && bestMeta.sizeAligned));
  const styleOnlyMatch =
    !!bestMeta &&
    bestMeta.tagMatches === 0 &&
    bestMeta.keywordMatches === 0 &&
    bestMeta.styleMatched &&
    bestMeta.formatMatched &&
    bestMeta.sizeAligned &&
    personalization.styleLevel === 'standard';

  if (!best || bestScore < 4 || !hasMeaningfulMatch || styleOnlyMatch) {
    const generated = await generateBundleWithAI(intake, personalization, opts);
    if (generated) {
      best = generated;
      source = 'generated';
      bestScore = 10;
    } else if (!best || bestScore < 4 || styleOnlyMatch) {
      best = null;
    }
  }

  if (!best) {
    const bundle = createFallbackBundle(intake, personalization, preferredCategory);
    best = bundle;
    source = 'fallback';
    bestScore = 5;
  }

  let requests = toRequests(best, personalization);
  if (!requests.length && source !== 'fallback') {
    const fallbackBundle = createFallbackBundle(intake, personalization, preferredCategory);
    best = fallbackBundle;
    source = 'fallback';
    bestScore = 5;
    requests = toRequests(best, personalization);
  }
  const format = personalization.preferredFormat;
  const helpers = buildHelperTasks({
    format,
    personaTags: personalization.personaTags,
    keywords: personalization.keywords,
    bundleName: best.name,
    iconCount: requests.length,
  });

  const personalizedBundle: StoredMagnetBundle = {
    ...best,
    iconSize: personalization.iconSize,
    styleLevel: personalization.styleLevel,
  };

  

  return {
    bundle: { ...personalizedBundle, source },
    requests: requests.length ? requests : buildFallbackIconRequests(intake),
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
