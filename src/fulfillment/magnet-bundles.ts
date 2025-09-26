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
  /**
   * When bundles are merged we preserve the originating section so printable sheets can
   * group icons accordingly.
   */
  section?: string;
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
  source?: 'stored' | 'generated';
}

export interface MagnetIconRequest {
  slug: string;
  label: string;
  description: string;
  tags: string[];
  tone: 'bright' | 'soft' | 'earthy';
  section?: string;
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
  pronouns?: string;
  genderIdentity?: string;
  householdSummary?: string;
  householdDetails?: {
    adults?: number;
    children?: number;
    label?: string;
  };
  soulTraits: string[];
  selectedBundles: string[];
}

export interface MagnetBundlePlan {
  bundle: StoredMagnetBundle & { source: 'stored' | 'generated' | 'fallback'; };
  requests: MagnetIconRequest[];
  helpers: HelperBotTask[];
  personalization: PersonalizationContext;
  keywords: string[];
  format: MagnetFormat;
  source: 'stored' | 'generated' | 'fallback';
  mergedFrom?: string[];
  reuseSuggestion?: string;
}

interface BundleModuleOptions {
  workspace?: FulfillmentWorkspace;
  staticPath?: string;
  runtimePath?: string;
  allowPersistence?: boolean;
  libraryPath?: string;
  trackLibrary?: boolean;
}

const STATIC_BUNDLE_PATH = path.resolve(process.cwd(), 'config', 'magnet-bundles.json');
const RUNTIME_BUNDLE_PATH = path.resolve(process.cwd(), 'data', 'generated-magnet-bundles.json');
const LIBRARY_PATH = path.resolve(process.cwd(), 'data', 'Magnet_Bundle_Library.json');

interface BundleStoreShape {
  bundles?: StoredMagnetBundle[];
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

const SOUL_TRAIT_LABELS: Record<string, string> = {
  mg: 'Move + Flow',
  'manifesting generator': 'Move + Flow',
  generator: 'Steady Spark',
  projector: 'Guide + Receive',
  manifestor: 'Initiate + Lead',
  reflector: 'Moon Mirror',
  'multi-hyphenate': 'Creative Cascade',
};

const CHILD_LABEL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Regulation/i, 'Calm Time'],
  [/Routine/i, 'Rhythm Time'],
  [/Ritual/i, 'Magic Moment'],
  [/Reset/i, 'Reset Time'],
  [/Checklist/i, 'Helper List'],
  [/Basket/i, 'Basket Time'],
];

const CHILD_DESCRIPTION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/grounding/i, 'calming'],
  [/regulate/i, 'steady'],
  [/intentional/i, 'thoughtful'],
  [/mindful/i, 'gentle'],
];

interface HouseholdDetails {
  adults?: number;
  children?: number;
  label?: string;
}

interface BundleLibraryEntry {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  personaTags: MagnetPersonaTag[];
  format: MagnetFormat;
  source: 'stored' | 'generated' | 'fallback';
  createdAt: string;
  email?: string;
  familyName?: string;
  mergedFrom?: string[];
  soulTraits?: string[];
  cohort?: PersonalizationContext['cohort'];
}

function normalizeSoulTraitLabel(trait: string): string | null {
  const key = trait.trim().toLowerCase();
  if (!key) return null;
  return SOUL_TRAIT_LABELS[key] || null;
}

function applyChildFriendlyText(value: string): string {
  if (!value) return value;
  let updated = value;
  for (const [pattern, replacement] of CHILD_LABEL_REPLACEMENTS) {
    updated = updated.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of CHILD_DESCRIPTION_REPLACEMENTS) {
    updated = updated.replace(pattern, replacement);
  }
  if (updated.length > 60) {
    updated = `${updated.slice(0, 57)}…`;
  }
  return updated;
}

function neutralizePronouns(value: string): string {
  if (!value) return value;
  return value
    .replace(/\bhe\b/gi, 'they')
    .replace(/\bshe\b/gi, 'they')
    .replace(/\bhim\b/gi, 'them')
    .replace(/\bher\b/gi, 'them')
    .replace(/\bhers\b/gi, 'theirs')
    .replace(/\bhis\b/gi, 'theirs');
}

function formatHouseholdSummary(summary?: string, details?: HouseholdDetails): string | undefined {
  if (summary) return summary;
  if (details?.label) return details.label;
  if (typeof details?.adults === 'number' || typeof details?.children === 'number') {
    const parts: string[] = [];
    if (details.adults) parts.push(`${details.adults} adult${details.adults > 1 ? 's' : ''}`);
    if (details.children) parts.push(`${details.children} kid${details.children > 1 ? 's' : ''}`);
    if (!parts.length) return undefined;
    return parts.join(' + ');
  }
  return undefined;
}

function parseHouseholdDetails(intake: NormalizedIntake): HouseholdDetails {
  const prefs = intake.prefs || {};
  const detailText = readField(prefs, ['household_summary', 'household_label', 'household_type', 'family_structure']);
  const details: HouseholdDetails = {};
  if (detailText) {
    const adultMatch = detailText.match(/(\d+)\s*(?:adult|parent)/i);
    const childMatch = detailText.match(/(\d+)\s*(?:kid|child|toddler|teen)/i);
    if (adultMatch) details.adults = Number(adultMatch[1]);
    if (childMatch) details.children = Number(childMatch[1]);
    details.label = detailText;
  }
  if (!details.label && Array.isArray(intake.customer?.householdMembers) && intake.customer.householdMembers.length) {
    details.label = `${intake.customer.householdMembers.length} in household`;
  }
  return details;
}

function extractSelectedBundles(intake: NormalizedIntake): string[] {
  const prefs = intake.prefs || {};
  const candidates: string[] = [];
  const raw = prefs.selected_bundles ?? prefs.bundle_merge ?? prefs.bundle_choices ?? prefs.bundle_focus;
  const ensureStringArray = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .forEach((item) => candidates.push(item));
      return;
    }
    if (typeof value === 'string') {
      value
        .split(/[,+/&]| and |\n/gi)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((item) => candidates.push(item));
    }
  };
  ensureStringArray(raw);
  ensureStringArray(prefs.selectedBundles);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

function extractSoulTraits(intake: NormalizedIntake): string[] {
  const prefs = intake.prefs || {};
  const traits = new Set<string>();
  const candidateFields = [
    prefs.soul_traits,
    prefs.hd_type,
    prefs.human_design_type,
    prefs.energy_type,
    prefs.soul_type,
    intake.raw?.soulType,
    intake.raw?.chart?.type,
  ];
  candidateFields.forEach((field) => {
    if (!field) return;
    if (Array.isArray(field)) {
      field
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
        .forEach((value) => traits.add(value));
      return;
    }
    if (typeof field === 'string') {
      field
        .split(/[,+/&]|\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((value) => traits.add(value));
    }
  });
  return Array.from(traits);
}

async function loadBundleLibrary(libraryPath: string = LIBRARY_PATH): Promise<BundleLibraryEntry[]> {
  try {
    const raw = await fs.readFile(libraryPath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed as BundleLibraryEntry[];
    if (Array.isArray((parsed as any)?.entries)) return (parsed as any).entries as BundleLibraryEntry[];
    return [];
  } catch {
    return [];
  }
}

async function saveBundleLibrary(entries: BundleLibraryEntry[], libraryPath: string = LIBRARY_PATH): Promise<void> {
  try {
    await fs.mkdir(path.dirname(libraryPath), { recursive: true });
    await fs.writeFile(libraryPath, JSON.stringify(entries, null, 2), 'utf8');
  } catch (err) {
    console.warn('[magnet-bundles] unable to persist bundle library:', err);
  }
}

async function appendBundleLibraryEntry(entry: BundleLibraryEntry, libraryPath: string = LIBRARY_PATH): Promise<void> {
  const entries = await loadBundleLibrary(libraryPath);
  entries.push(entry);
  await saveBundleLibrary(entries, libraryPath);
}

function findReusableLibraryEntry(
  entries: BundleLibraryEntry[],
  intake: NormalizedIntake,
  personalization: PersonalizationContext
): BundleLibraryEntry | null {
  if (!entries.length) return null;
  const email = intake.email?.toLowerCase();
  const family = personalization.familyName?.toLowerCase();
  let best: { entry: BundleLibraryEntry; score: number } | null = null;
  for (const entry of entries) {
    let score = 0;
    if (email && entry.email?.toLowerCase() === email) score += 4;
    if (family && entry.familyName?.toLowerCase() === family) score += 3;
    const keywordMatches = personalization.keywords.filter((kw) => entry.keywords?.includes(kw)).length;
    score += Math.min(keywordMatches, 3);
    const traitMatches = personalization.soulTraits.filter((trait) =>
      entry.soulTraits?.some((stored) => stored.toLowerCase() === trait.toLowerCase())
    ).length;
    score += traitMatches;
    if (!best || score > best.score) {
      best = { entry, score };
    }
  }
  return best && best.score >= 4 ? best.entry : null;
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
    staticBundles = Array.isArray(parsed.bundles) ? parsed.bundles : [];
    staticBundles = staticBundles.map((bundle) => ({ ...bundle, source: 'stored' }));
  } catch (err) {
    console.warn('[magnet-bundles] failed to read static bundle store:', err);
  }

  try {
    const raw = await fs.readFile(runtimePath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    runtimeBundles = (Array.isArray(parsed) ? parsed : parsed.bundles || []).map((bundle) => ({
      ...bundle,
      source: bundle.source || 'generated',
    }));
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

function ensureSuffix(base: string, suffix: string): string {
  if (!suffix) return base;
  if (base.toLowerCase().includes(suffix.toLowerCase())) return base;
  return `${base} – ${suffix}`;
}

function personalizeIcon(icon: BundleIconDefinition, personalization: PersonalizationContext): BundleIconDefinition {
  let label = icon.label;
  let description = icon.description;
  const childMode = personalization.cohort === 'child';
  if (childMode) {
    label = applyChildFriendlyText(label);
    description = applyChildFriendlyText(description);
  }
  const needsNeutralPronouns =
    !personalization.pronouns ||
    /they|them|she\/they|he\/they|nonbinary|fluid|queer/i.test(personalization.pronouns || personalization.genderIdentity || '');
  if (needsNeutralPronouns) {
    label = neutralizePronouns(label);
    description = neutralizePronouns(description);
  }
  return {
    ...icon,
    label,
    description,
  };
}

export function personalizeBundle(
  bundle: StoredMagnetBundle,
  personalization: PersonalizationContext
): StoredMagnetBundle {
  const clone: StoredMagnetBundle = {
    ...bundle,
    icons: bundle.icons.map((icon) => personalizeIcon({ ...icon }, personalization)),
  };

  const traitLabel = personalization.soulTraits
    .map((trait) => normalizeSoulTraitLabel(trait))
    .filter(Boolean)
    .shift();
  if (traitLabel) {
    clone.name = ensureSuffix(clone.name, traitLabel);
    clone.description = `${clone.description || ''} Soul trait focus: ${traitLabel}.`.trim();
    const movementIcon = clone.icons.find((icon) => icon.tags?.some((tag) => /move|flow|dance|body|reset/i.test(tag)));
    if (movementIcon) {
      movementIcon.label = ensureSuffix(movementIcon.label, traitLabel);
    }
  }

  if (personalization.cohort === 'child') {
    clone.description = `${clone.description || ''} Written in kid-friendly language.`.trim();
  }

  const householdSummary = formatHouseholdSummary(
    personalization.householdSummary,
    personalization.householdDetails
  );
  if (householdSummary) {
    clone.name = ensureSuffix(clone.name, householdSummary);
    clone.description = `${clone.description || ''} Tailored for ${householdSummary.toLowerCase()}.`.trim();
    clone.icons = clone.icons.map((icon) => ({ ...icon, section: icon.section || householdSummary }));
  }

  const needsNeutralPronouns =
    !personalization.pronouns ||
    /they|them|she\/they|he\/they|nonbinary|fluid|queer/i.test(personalization.pronouns || personalization.genderIdentity || '');
  if (needsNeutralPronouns) {
    clone.name = neutralizePronouns(clone.name);
    clone.description = neutralizePronouns(clone.description || '');
  }

  return clone;
}

function mergeBundles(bundles: StoredMagnetBundle[]): StoredMagnetBundle {
  const uniqueBundles = bundles.filter((bundle, index, arr) => arr.findIndex((b) => b.id === bundle.id) === index);
  const names = uniqueBundles.map((bundle) => bundle.name);
  const id = `merge-${slugify(names.join('-'))}`;
  const keywords = Array.from(
    new Set(uniqueBundles.flatMap((bundle) => bundle.keywords || []).map((kw) => kw.toLowerCase()))
  );
  const personaTags = Array.from(
    new Set(uniqueBundles.flatMap((bundle) => bundle.personaTags || []))
  ) as MagnetPersonaTag[];
  const formats = Array.from(new Set(uniqueBundles.flatMap((bundle) => bundle.formats || [])));
  const icons: BundleIconDefinition[] = uniqueBundles.flatMap((bundle) =>
    bundle.icons.map((icon, index) => ({
      ...icon,
      slug: `${icon.slug}-${slugify(bundle.name)}-${index}`,
      section: icon.section || bundle.name,
    }))
  );
  return {
    id,
    name: `Custom Merge – ${names.join(' + ')}`,
    category: 'Combined',
    description: `Merged bundle with printable sections for ${names.join(', ')}.`,
    keywords,
    personaTags,
    formats,
    icons,
    source: 'stored',
  };
}

function findBundleMatch(bundles: StoredMagnetBundle[], query: string): StoredMagnetBundle | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  return (
    bundles.find((bundle) => bundle.id.toLowerCase() === normalized) ||
    bundles.find((bundle) => bundle.name.toLowerCase() === normalized) ||
    bundles.find((bundle) => bundle.name.toLowerCase().includes(normalized)) ||
    null
  );
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
  sections?: string[];
}): HelperBotTask[] {
  const helpers: HelperBotTask[] = [];
  const sectionHint = plan.sections?.length ? ` Sections: ${plan.sections.join(', ')}.` : '';
  helpers.push({
    name: 'bundle-sorter',
    instructions: `Tag ${plan.iconCount} icons for ${plan.bundleName} with persona keywords ${
      plan.personaTags.join(', ') || 'general'
    }.${sectionHint}`.trim(),
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
      instructions: `Lay out printable PDF sheet in US Letter and A4 with crop marks, bundle title header, and grouped sections${
        plan.sections?.length ? ` for ${plan.sections.join(', ')}` : ''
      }.`,
      payload: { format: plan.format, sections: plan.sections },
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
      section: icon.section,
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
      soulTraits: personalization.soulTraits,
    };
    const system = `You are Maggie the icon librarian. Create tailored magnet bundles that feel cozy, spiritual, and regulated.`;
    const soulTraitSummary = personalization.soulTraits.join(', ') || 'general energy';
    const user = `Generate a magnet icon bundle as JSON with fields {"name","category","description","icons":[{"slug","label","description","tags","tone"}],"keywords"}. Persona tags: ${personaSummary}. Keywords: ${personalization.keywords.join(', ')}. Preferred format: ${personalization.preferredFormat}. Soul traits: ${soulTraitSummary}.`;
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
  const pronouns = readField(intake.prefs || {}, ['pronouns', 'preferred_pronouns']) || intake.customer?.pronouns;
  const genderIdentity = readField(intake.prefs || {}, ['gender_identity', 'gender']);
  const householdDetails = parseHouseholdDetails(intake);
  const householdSummary = formatHouseholdSummary(
    readField(intake.prefs || {}, ['household_summary', 'household_label', 'household_type', 'family_structure']),
    householdDetails
  );
  const soulTraits = extractSoulTraits(intake);
  const selectedBundles = extractSelectedBundles(intake);
  return {
    familyName,
    childName,
    rhythmStyle,
    cohort: intake.ageCohort,
    preferredFormat,
    personaTags,
    keywords,
    pronouns,
    genderIdentity,
    householdSummary,
    householdDetails,
    soulTraits,
    selectedBundles,
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
  let mergedFrom: string[] | undefined;

  if (personalization.selectedBundles.length) {
    const matched = personalization.selectedBundles
      .map((selection) => findBundleMatch(bundles, selection))
      .filter((bundle): bundle is StoredMagnetBundle => Boolean(bundle));
    if (matched.length >= 2) {
      best = mergeBundles(matched);
      mergedFrom = matched.map((bundle) => bundle.name);
      bestScore = 100;
    } else if (matched.length === 1) {
      best = matched[0];
      bestScore = 80;
    }
  }

  if (!best) {
    for (const bundle of bundles) {
      const score = scoreBundle(
        bundle,
        preferredCategory,
        personalization.personaTags,
        personalization.keywords,
        personalization.preferredFormat
      );
      if (score > bestScore) {
        best = bundle;
        bestScore = score;
      }
    }
  }

  let source: MagnetBundlePlan['source'] = best?.source === 'generated' ? 'generated' : 'stored';
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
      source: 'stored',
    };
    best = bundle;
    source = 'fallback';
    bestScore = 5;
  }

  const personalizedBundle = personalizeBundle(best, personalization);
  const requests = toRequests(personalizedBundle, personalization);
  const format = personalization.preferredFormat;
  const sections = Array.from(
    new Set(personalizedBundle.icons.map((icon) => icon.section).filter(Boolean))
  ) as string[];
  const helpers = buildHelperTasks({
    format,
    personaTags: personalization.personaTags,
    keywords: personalization.keywords,
    bundleName: personalizedBundle.name,
    iconCount: requests.length,
    sections,
  });

  const plan: MagnetBundlePlan = {
    bundle: { ...personalizedBundle, source },
    requests: requests.length ? requests : buildFallbackIconRequests(intake),
    helpers,
    personalization,
    keywords: personalization.keywords,
    format,
    source,
    mergedFrom,
  };

  const libraryPath = opts.libraryPath || LIBRARY_PATH;
  const trackLibrary = opts.trackLibrary !== false;
  const libraryEntries = await loadBundleLibrary(libraryPath);
  const reuseEntry = findReusableLibraryEntry(libraryEntries, intake, personalization);
  if (reuseEntry) {
    plan.reuseSuggestion = `Found a ${reuseEntry.name} bundle from your blueprint. Want to reuse or tweak it?`;
  }

  if (trackLibrary) {
    await appendBundleLibraryEntry(
      {
        id: plan.bundle.id,
        name: plan.bundle.name,
        category: plan.bundle.category,
        keywords: plan.bundle.keywords || plan.keywords,
        personaTags: plan.personalization.personaTags,
        format: plan.format,
        source: plan.source,
        createdAt: new Date().toISOString(),
        email: intake.email,
        familyName: personalization.familyName,
        mergedFrom: plan.mergedFrom,
        soulTraits: personalization.soulTraits,
        cohort: personalization.cohort,
      },
      libraryPath
    );
  }

  return plan;
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
