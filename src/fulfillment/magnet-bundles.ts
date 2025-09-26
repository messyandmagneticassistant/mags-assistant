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
  isBlank?: boolean;
}

export interface BlankMagnetPlaceholder {
  slug: string;
  label: string;
  description: string;
  quantity: number;
  tags: string[];
  tone: MagnetIconRequest['tone'];
}

export interface MagnetBundleLayoutIcon {
  slug: string;
  label: string;
  isBlank?: boolean;
}

export interface MagnetBundleLayoutSection {
  title: string;
  description?: string;
  icons: MagnetBundleLayoutIcon[];
}

export interface MagnetBundleLayout {
  id: string;
  title: string;
  summary: string;
  format: MagnetFormat;
  sections: MagnetBundleLayoutSection[];
  notes?: string;
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
  soulTraits?: string[];
  genderIdentity?: string;
  pronouns?: string;
  householdSummary?: string;
}

export interface PersonalizationProfile {
  soulTraits?: string[];
  ageCohort?: 'child' | 'teen' | 'adult' | 'elder';
  genderIdentity?: string;
  pronouns?: string;
  householdSummary?: string;
}

export interface ReuseProfile extends PersonalizationProfile {
  keywords?: string[];
  personaTags?: MagnetPersonaTag[];
  preferredCategory?: string;
}

export interface MagnetBundlePlan {
  bundle: StoredMagnetBundle & { source: 'stored' | 'generated' | 'fallback'; };
  requests: MagnetIconRequest[];
  helpers: HelperBotTask[];
  personalization: PersonalizationContext;
  keywords: string[];
  format: MagnetFormat;
  source: 'stored' | 'generated' | 'fallback';
  placeholders: BlankMagnetPlaceholder[];
  layout?: MagnetBundleLayout;
}

interface BundleModuleOptions {
  workspace?: FulfillmentWorkspace;
  staticPath?: string;
  runtimePath?: string;
  allowPersistence?: boolean;
  libraryPath?: string;
  allowLibraryTracking?: boolean;
}

const STATIC_BUNDLE_PATH = path.resolve(process.cwd(), 'config', 'magnet-bundles.json');
const RUNTIME_BUNDLE_PATH = path.resolve(process.cwd(), 'data', 'generated-magnet-bundles.json');
const BUNDLE_LIBRARY_PATH = path.resolve(process.cwd(), 'data', 'Magnet_Bundle_Library.json');

interface BundleStoreShape {
  bundles?: StoredMagnetBundle[];
}

interface BundleLibraryVersion {
  id: string;
  createdAt: string;
  profile: PersonalizationProfile & {
    keywords?: string[];
    personaTags?: MagnetPersonaTag[];
    preferredFormat?: MagnetFormat;
  };
  bundle: StoredMagnetBundle & { source?: 'stored' | 'generated' | 'fallback' };
}

interface BundleLibraryEntry {
  bundleId: string;
  name: string;
  category: string;
  versions: BundleLibraryVersion[];
}

interface BundleLibraryStore {
  bundles: BundleLibraryEntry[];
}

const SOUL_TRAIT_TITLES: Record<string, string> = {
  mg: 'Move + Flow',
  'manifesting generator': 'Move + Flow',
  generator: 'Glow + Steady',
  manifester: 'Spark + Initiate',
  projector: 'Guide + Glow',
  reflector: 'Mirror + Moon',
  mystic: 'Mystic Flow',
  alchemist: 'Alchemize & Anchor',
};

const GENDERED_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /\b(she|he)\b/gi, replacement: 'they' },
  { regex: /\b(her|him)\b/gi, replacement: 'them' },
  { regex: /\b(hers|his)\b/gi, replacement: 'theirs' },
  { regex: /\b(mom|mother|mama)\b/gi, replacement: 'caregiver' },
  { regex: /\b(dad|father|papa)\b/gi, replacement: 'caregiver' },
];

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

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeTrait(trait: string): string {
  return trait.trim().toLowerCase();
}

function resolveTraitTitle(trait: string): string {
  const normalized = normalizeTrait(trait);
  return SOUL_TRAIT_TITLES[normalized] || titleCase(trait.trim());
}

function buildTraitTitle(traits: string[] | undefined): string | undefined {
  if (!traits || !traits.length) return undefined;
  const seen = new Set<string>();
  const titles = traits
    .map((trait) => resolveTraitTitle(trait))
    .filter((title) => {
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!titles.length) return undefined;
  if (titles.length === 1) return titles[0];
  return titles.join(' + ');
}

function neutralizeGenderedLanguage(input: string, pronouns?: string): string {
  if (!input) return input;
  let neutralBase = 'they';
  if (pronouns && pronouns.includes('/')) {
    neutralBase = pronouns.split('/')[0]?.trim().toLowerCase() || 'they';
  } else if (pronouns) {
    neutralBase = pronouns.trim().toLowerCase();
  }

  const replacements = GENDERED_PATTERNS.map(({ regex, replacement }) => ({
    regex,
    replacement: replacement === 'they' ? neutralBase : replacement,
  }));

  let output = input;
  for (const { regex, replacement } of replacements) {
    output = output.replace(regex, (match) => {
      if (!replacement) return match;
      if (match === match.toUpperCase()) return replacement.toUpperCase();
      if (match[0] === match[0].toUpperCase())
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      return replacement;
    });
  }
  return output;
}

function simplifyForCohort(text: string, cohort?: 'child' | 'teen' | 'adult' | 'elder'): string {
  if (!text || !cohort) return text;
  if (cohort === 'child') {
    const sentence = text.split(/[.!?]/)[0]?.trim() || text;
    const words = sentence.split(/\s+/).slice(0, 12).join(' ');
    return words ? `${words}${words.endsWith('.') ? '' : '.'}` : sentence;
  }
  if (cohort === 'teen') {
    const sentence = text.split(/[.!?]/)[0]?.trim() || text;
    return sentence.length > 0 ? sentence : text;
  }
  return text;
}

function applyHouseholdContext(
  text: string,
  householdSummary?: string,
  fallbackPrefix = 'Designed for'
): string {
  if (!text) return text;
  if (!householdSummary) return text;
  if (text.toLowerCase().includes(householdSummary.toLowerCase())) return text;
  return `${text.trim()} ${fallbackPrefix} ${householdSummary}.`.replace(/\s+/g, ' ').trim();
}

const BLANK_CONFIG_KEYS = [
  'blank_magnets',
  'blankMagnets',
  'blank_icons',
  'blankIcons',
  'blank_slots',
  'blankSlots',
  'blankRequests',
  'blankPlaceholders',
];

const BLANK_COUNT_KEYS = [
  'blank_magnet_count',
  'blankMagnetCount',
  'blank_count',
  'blankCount',
  'extra_blank_magnets',
  'extraBlankMagnets',
  'blank_slots_count',
  'blankSlotsCount',
];

export interface NormalizeBlankOptions {
  defaultLabel?: string;
  defaultDescription?: string;
  defaultTone?: MagnetIconRequest['tone'];
  defaultTags?: string[];
}

function coerceBlankNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/-?\d+/);
    if (match) {
      const parsed = Number.parseInt(match[0], 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizeBlankConfig(
  prefs: Record<string, any> | undefined,
  options: NormalizeBlankOptions = {}
): BlankMagnetPlaceholder[] {
  if (!prefs) return [];

  const defaults = {
    label: options.defaultLabel?.trim() || 'Blank magnet',
    description:
      options.defaultDescription?.trim() || 'Intentionally left blank so the household can write in custom rhythms.',
    tone: options.defaultTone || 'soft',
    tags: (options.defaultTags && options.defaultTags.length
      ? options.defaultTags
      : ['blank'])
      .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
      .filter(Boolean),
  };
  if (!defaults.tags.length) defaults.tags.push('blank');

  const rawValues: unknown[] = [];
  for (const key of BLANK_CONFIG_KEYS) {
    const value = prefs[key];
    if (value !== undefined && value !== null && value !== '') {
      rawValues.push(value);
    }
  }

  for (const key of BLANK_COUNT_KEYS) {
    const count = coerceBlankNumber(prefs[key]);
    if (count && count > 0) {
      rawValues.push(count);
    }
  }

  if (!rawValues.length) {
    return [];
  }

  const placeholders: BlankMagnetPlaceholder[] = [];
  const slugCounter = new Map<string, number>();
  let placeholderIndex = 0;

  const pushPlaceholder = (input: {
    label?: string;
    description?: string;
    quantity?: number;
    tone?: string;
    tags?: unknown;
    slug?: string;
  }) => {
    const quantityRaw = input.quantity ?? 1;
    const quantityNumber = coerceBlankNumber(quantityRaw);
    const safeQuantity = quantityNumber === undefined ? 1 : Math.abs(Math.round(quantityNumber));
    if (!safeQuantity) return;

    const label = input.label && typeof input.label === 'string' && input.label.trim()
      ? input.label.trim()
      : defaults.label;
    const description = input.description && typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : defaults.description;

    const toneRaw = typeof input.tone === 'string' ? input.tone.trim().toLowerCase() : '';
    const tone: MagnetIconRequest['tone'] = toneRaw === 'bright' || toneRaw === 'earthy' ? (toneRaw as MagnetIconRequest['tone']) : defaults.tone;

    const normalizedTags = new Set(defaults.tags);
    const providedTags = Array.isArray(input.tags) ? input.tags : toArray(input.tags as any);
    for (const tag of providedTags) {
      if (typeof tag === 'string' && tag.trim()) {
        normalizedTags.add(tag.trim().toLowerCase());
      }
    }
    normalizedTags.add('blank');

    const baseSlug =
      input.slug && typeof input.slug === 'string' && input.slug.trim()
        ? slugify(input.slug)
        : slugify(`${label}-${placeholderIndex + 1}`) || `blank-magnet-${placeholderIndex + 1}`;

    const duplicateCount = slugCounter.get(baseSlug) || 0;
    slugCounter.set(baseSlug, duplicateCount + 1);
    const slug = duplicateCount ? `${baseSlug}-${duplicateCount + 1}` : baseSlug;

    placeholders.push({
      slug,
      label,
      description,
      quantity: safeQuantity,
      tone,
      tags: Array.from(normalizedTags),
    });

    placeholderIndex += 1;
  };

  const processValue = (value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(processValue);
      return;
    }
    if (typeof value === 'number') {
      pushPlaceholder({ quantity: value });
      return;
    }
    if (typeof value === 'boolean') {
      if (value) pushPlaceholder({ quantity: 1 });
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return;
      const quantity = coerceBlankNumber(trimmed) ?? 1;
      const labelCandidate = trimmed
        .replace(/\d+x?/gi, ' ')
        .replace(/blank(s)?/gi, ' ')
        .replace(/[\-*]/g, ' ')
        .trim();
      const label = labelCandidate ? titleCase(labelCandidate) : undefined;
      pushPlaceholder({ label, quantity });
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, any>;
      const quantity =
        coerceBlankNumber(record.count ?? record.quantity ?? record.qty ?? record.amount ?? record.total ?? record.number) ?? 1;
      const label = typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : undefined;
      const description = typeof record.description === 'string' && record.description.trim()
        ? record.description.trim()
        : typeof record.note === 'string' && record.note.trim()
        ? record.note.trim()
        : undefined;
      pushPlaceholder({
        label,
        description,
        quantity,
        tone: record.tone,
        tags: record.tags ?? record.keywords,
        slug: record.slug,
      });
    }
  };

  rawValues.forEach(processValue);

  return placeholders;
}

function expandBlankRequests(placeholders: BlankMagnetPlaceholder[]): MagnetIconRequest[] {
  const requests: MagnetIconRequest[] = [];
  const slugCounter = new Map<string, number>();

  for (const placeholder of placeholders) {
    const baseSlug = placeholder.slug || slugify(`${placeholder.label}-blank`);
    for (let index = 0; index < placeholder.quantity; index += 1) {
      const existing = slugCounter.get(baseSlug) || 0;
      slugCounter.set(baseSlug, existing + 1);
      const slug = existing === 0 && placeholder.quantity === 1 ? baseSlug : `${baseSlug}-${existing + 1}`;
      const label = placeholder.quantity > 1 ? `${placeholder.label} ${existing + 1}` : placeholder.label;
      requests.push({
        slug,
        label,
        description: placeholder.description,
        tags: placeholder.tags.length ? placeholder.tags : ['blank'],
        tone: placeholder.tone,
        isBlank: true,
      });
    }
  }

  return requests;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    output.push(items.slice(i, i + chunkSize));
  }
  return output;
}

function fallbackBundleLayout(plan: MagnetBundlePlan): MagnetBundleLayout {
  const nonBlank = plan.requests.filter((request) => !request.isBlank);
  const blanks = plan.requests.filter((request) => request.isBlank);
  const chunkSize = plan.format === 'printable' || plan.format === 'pdf' ? 9 : 6;
  const sections: MagnetBundleLayoutSection[] = [];

  if (nonBlank.length) {
    const groups = chunkArray(nonBlank, chunkSize);
    groups.forEach((group, index) => {
      sections.push({
        title: groups.length > 1 ? `Icon Set ${index + 1}` : plan.bundle.name,
        description: index === 0 ? plan.bundle.description : undefined,
        icons: group.map((icon) => ({ slug: icon.slug, label: icon.label, isBlank: icon.isBlank })),
      });
    });
  }

  if (blanks.length) {
    sections.push({
      title: 'Blank Magnets',
      description: 'Intentionally empty slots reserved for handwriting or future icons.',
      icons: blanks.map((icon) => ({ slug: icon.slug, label: icon.label, isBlank: true })),
    });
  }

  if (!sections.length) {
    sections.push({
      title: plan.bundle.name,
      description: plan.bundle.description,
      icons: [],
    });
  }

  const summaryParts: string[] = [];
  if (plan.bundle.description) summaryParts.push(plan.bundle.description);
  if (plan.personalization.householdSummary)
    summaryParts.push(`Household: ${plan.personalization.householdSummary}.`);
  if (plan.placeholders.length) summaryParts.push('Includes blank magnet placeholders for handwriting.');

  const layoutId = `layout-${slugify(plan.bundle.id || plan.bundle.name || 'bundle')}`;

  return {
    id: layoutId,
    title: plan.bundle.name,
    summary: summaryParts.join(' ') || 'Layout for printable magnet sheet.',
    format: plan.format,
    sections,
    notes: blanks.length ? 'Include blank magnet placeholders when preparing the printable sheet.' : undefined,
  };
}

export async function generateBundleLayout(
  intake: NormalizedIntake,
  plan: MagnetBundlePlan,
  _opts: BundleModuleOptions = {}
): Promise<MagnetBundleLayout> {
  const fallback = fallbackBundleLayout(plan);
  const hasAiKey = Boolean(
    process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_GPT || process.env.MAGGIE_OPENAI_KEY
  );
  if (!hasAiKey) {
    return fallback;
  }
  try {
    const response = await chatJSON<{
      title?: string;
      summary?: string;
      notes?: string;
      sections?: Array<{
        title?: string;
        description?: string;
        icons?: Array<{ slug?: string; label?: string; isBlank?: boolean }>;
      }>;
    }>(
      "You are Maggie's magnet printable layout designer. Respond with clean JSON matching the schema {\"title\",\"summary\",\"notes?\",\"sections\":[{\"title\",\"description?\",\"icons\":[{\"slug\",\"label\",\"isBlank?\"}]}]}.",
      `Bundle layout plan:${JSON.stringify(
        {
          bundle: {
            id: plan.bundle.id,
            name: plan.bundle.name,
            category: plan.bundle.category,
          },
          format: plan.format,
          intake: { tier: intake.tier, email: intake.email },
          personalization: {
            cohort: plan.personalization.cohort,
            household: plan.personalization.householdSummary,
            soulTraits: plan.personalization.soulTraits,
          },
          placeholders: plan.placeholders,
          icons: plan.requests.map((request) => ({
            slug: request.slug,
            label: request.label,
            description: request.description,
            tags: request.tags,
            tone: request.tone,
            isBlank: Boolean(request.isBlank),
          })),
        },
        null,
        2
      )}`
    );

    if (!response || !Array.isArray(response.sections) || !response.sections.length) {
      return fallback;
    }

    const sanitizedSections: MagnetBundleLayoutSection[] = response.sections
      .map((section, index) => {
        const icons = Array.isArray(section.icons)
          ? section.icons
              .map((icon) => {
                const slug = icon.slug?.trim();
                const label = icon.label?.trim();
                if (!slug || !label) return null;
                return {
                  slug,
                  label,
                  isBlank:
                    icon.isBlank === true || plan.requests.some((request) => request.slug === slug && request.isBlank),
                };
              })
              .filter((icon): icon is MagnetBundleLayoutIcon => Boolean(icon))
          : [];
        if (!icons.length) return null;
        const title = section.title?.trim() || `Section ${index + 1}`;
        const description = section.description?.trim() || undefined;
        return { title, description, icons };
      })
      .filter((section): section is MagnetBundleLayoutSection => Boolean(section));

    if (!sanitizedSections.length) return fallback;

    const listedSlugs = new Set<string>();
    for (const section of sanitizedSections) {
      for (const icon of section.icons) {
        listedSlugs.add(icon.slug);
      }
    }

    const missingIcons = plan.requests.filter((request) => !listedSlugs.has(request.slug));
    if (missingIcons.length) {
      sanitizedSections.push({
        title: 'Ungrouped Icons',
        description: 'Automatically added icons to ensure the printable layout includes every magnet.',
        icons: missingIcons.map((icon) => ({ slug: icon.slug, label: icon.label, isBlank: icon.isBlank })),
      });
    }

    const layout: MagnetBundleLayout = {
      id: fallback.id,
      title: response.title?.trim() || fallback.title,
      summary: response.summary?.trim() || fallback.summary,
      format: plan.format,
      sections: sanitizedSections,
      notes: response.notes?.trim() || fallback.notes,
    };

    if (plan.placeholders.length && !layout.notes) {
      layout.notes = 'Remember to include blank magnet placeholders when exporting the printable sheet.';
    }

    return layout;
  } catch (err) {
    console.warn('[magnet-bundles] failed to generate bundle layout:', err);
    return fallback;
  }
}

async function loadBundleLibrary(libraryPath: string): Promise<BundleLibraryStore> {
  try {
    const raw = await fs.readFile(libraryPath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (Array.isArray(parsed)) {
      return { bundles: parsed as BundleLibraryEntry[] };
    }
    if (parsed && Array.isArray(parsed.bundles)) {
      return { bundles: parsed.bundles };
    }
    return { bundles: [] };
  } catch (err) {
    return { bundles: [] };
  }
}

async function saveBundleLibrary(libraryPath: string, store: BundleLibraryStore): Promise<void> {
  await fs.mkdir(path.dirname(libraryPath), { recursive: true });
  await fs.writeFile(libraryPath, JSON.stringify({ bundles: store.bundles }, null, 2));
}

async function trackBundleLibraryVersion(
  bundle: StoredMagnetBundle & { source?: 'stored' | 'generated' | 'fallback' },
  personalization: PersonalizationContext,
  opts: BundleModuleOptions
): Promise<void> {
  if (opts.allowLibraryTracking === false) return;
  const libraryPath = opts.libraryPath || BUNDLE_LIBRARY_PATH;
  try {
    const store = await loadBundleLibrary(libraryPath);
    let entry = store.bundles.find((item) => item.bundleId === bundle.id);
    if (!entry) {
      entry = { bundleId: bundle.id, name: bundle.name, category: bundle.category, versions: [] };
      store.bundles.push(entry);
    } else {
      entry.name = bundle.name;
      entry.category = bundle.category;
    }

    const version: BundleLibraryVersion = {
      id: `v-${Date.now()}`,
      createdAt: new Date().toISOString(),
      profile: {
        soulTraits: personalization.soulTraits,
        ageCohort: personalization.cohort,
        genderIdentity: personalization.genderIdentity,
        pronouns: personalization.pronouns,
        householdSummary: personalization.householdSummary,
        keywords: personalization.keywords,
        personaTags: personalization.personaTags,
        preferredFormat: personalization.preferredFormat,
      },
      bundle: { ...bundle },
    };

    entry.versions.push(version);
    if (entry.versions.length > 25) {
      entry.versions = entry.versions.slice(-25);
    }

    await saveBundleLibrary(libraryPath, store);
  } catch (err) {
    console.warn('[magnet-bundles] failed to track bundle library version:', err);
  }
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

function collectSoulTraits(prefs: Record<string, any>): string[] {
  const fields = [
    'soul_traits',
    'soul_trait',
    'soul_type',
    'design_type',
    'human_design',
    'blueprint_traits',
    'soul_chart_traits',
  ];
  const traits = new Set<string>();
  for (const field of fields) {
    const value = prefs?.[field];
    if (typeof value === 'string') {
      value
        .split(/[+,/\n]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => traits.add(part));
    }
    if (Array.isArray(value)) {
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .forEach((part) => traits.add(part));
    }
  }
  return Array.from(traits);
}

function describeHousehold(intake: NormalizedIntake): string | undefined {
  const members = (intake.customer?.householdMembers || []).map((member) => member.trim()).filter(Boolean);
  const prefs = intake.prefs || {};
  const householdText = readField(prefs, ['household', 'household_type', 'family_structure', 'family']);
  if (members.length) {
    const kidCount = members.filter((member) => /kid|child|son|daughter|teen/i.test(member)).length;
    const adultCount = members.length - kidCount;
    if (kidCount && adultCount) {
      const adultLabel = adultCount > 1 ? `${adultCount} Adults` : 'Parent';
      const kidLabel = `${kidCount} Kid${kidCount > 1 ? 's' : ''}`;
      return `${adultLabel} + ${kidLabel}`;
    }
    return members.join(' + ');
  }
  if (householdText) {
    if (/parent|kid|child|family|household/i.test(householdText)) {
      return titleCase(householdText);
    }
  }
  return undefined;
}

function scoreLibraryMatch(
  entry: BundleLibraryEntry,
  version: BundleLibraryVersion,
  profile: ReuseProfile
): number {
  let score = 0;
  const targetTraits = profile.soulTraits?.map(normalizeTrait) || [];
  const versionTraits = version.profile.soulTraits?.map(normalizeTrait) || [];
  const traitMatches = targetTraits.filter((trait) => versionTraits.includes(trait)).length;
  score += traitMatches * 4;

  if (profile.householdSummary && version.profile.householdSummary) {
    const target = profile.householdSummary.toLowerCase();
    const existing = version.profile.householdSummary.toLowerCase();
    if (existing === target) score += 3;
    else if (existing.includes(target) || target.includes(existing)) score += 2;
  }

  if (profile.preferredCategory && entry.category) {
    if (entry.category.toLowerCase() === profile.preferredCategory.toLowerCase()) score += 2;
  }

  const targetKeywords = (profile.keywords || []).map((kw) => kw.toLowerCase());
  const versionKeywords = (version.profile.keywords || []).map((kw) => kw.toLowerCase());
  const keywordMatches = targetKeywords.filter((kw) => versionKeywords.includes(kw)).length;
  score += Math.min(keywordMatches, 3);

  const personaMatches = (profile.personaTags || []).filter((tag) => version.profile.personaTags?.includes(tag)).length;
  score += personaMatches;

  if (version.bundle.source === 'generated') score += 1;

  return score;
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

export function personalizeBundle(
  bundle: StoredMagnetBundle,
  profile: PersonalizationProfile
): StoredMagnetBundle {
  const traitTitle = buildTraitTitle(profile.soulTraits);
  const primaryTrait = traitTitle ? traitTitle.split(' + ')[0] : undefined;
  const nameWithTrait = traitTitle ? `${traitTitle} ${bundle.name}` : bundle.name;
  const name = profile.householdSummary
    ? `${nameWithTrait} – ${profile.householdSummary}`.trim()
    : nameWithTrait.trim();

  const descriptionParts: string[] = [];
  if (traitTitle) descriptionParts.push(`Aligned to ${traitTitle} energy.`);
  if (bundle.description) descriptionParts.push(bundle.description);
  if (profile.householdSummary) descriptionParts.push(`Household: ${profile.householdSummary}.`);

  let description = descriptionParts.filter(Boolean).join(' ');
  description = neutralizeGenderedLanguage(description, profile.pronouns || profile.genderIdentity);
  description = simplifyForCohort(description, profile.ageCohort);
  description = applyHouseholdContext(description, profile.householdSummary, 'Perfect for');

  const icons = bundle.icons.map((icon) => {
    let label = icon.label;
    if (primaryTrait && /flow|reset|move|spark|anchor|glow|focus/i.test(icon.label) &&
      !label.toLowerCase().includes(primaryTrait.toLowerCase())) {
      label = `${primaryTrait} ${label}`.replace(/\s+/g, ' ').trim();
    }
    if (profile.householdSummary && icon.tags?.some((tag) => /(family|household|kid|child)/i.test(tag))) {
      if (!label.includes(profile.householdSummary)) {
        label = `${label} (${profile.householdSummary})`;
      }
    }

    let iconDescription = neutralizeGenderedLanguage(icon.description, profile.pronouns || profile.genderIdentity);
    iconDescription = simplifyForCohort(iconDescription, profile.ageCohort);
    iconDescription = applyHouseholdContext(iconDescription, profile.householdSummary, 'For');

    return {
      ...icon,
      label,
      description: iconDescription,
    };
  });

  return {
    ...bundle,
    name,
    description,
    icons,
  };
}

function buildHelperTasks(plan: {
  format: MagnetFormat;
  personaTags: MagnetPersonaTag[];
  keywords: string[];
  bundleName: string;
  iconCount: number;
  blankCount?: number;
}): HelperBotTask[] {
  const helpers: HelperBotTask[] = [];
  const blankNote =
    plan.blankCount && plan.blankCount > 0
      ? ` (includes ${plan.blankCount} blank placeholder${plan.blankCount > 1 ? 's' : ''})`
      : '';
  helpers.push({
    name: 'bundle-sorter',
    instructions: `Tag ${plan.iconCount} icons${blankNote} for ${plan.bundleName} with persona keywords ${
      plan.personaTags.join(', ') || 'general'
    }.`,
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

function dedupeRequests(requests: MagnetIconRequest[]): MagnetIconRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = request.slug?.toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const soulTraits = collectSoulTraits(intake.prefs || {});
  const genderIdentity = readField(intake.prefs || {}, ['gender_identity', 'gender']);
  const pronouns = intake.customer?.pronouns;
  const householdSummary = describeHousehold(intake);
  return {
    familyName,
    childName,
    rhythmStyle,
    cohort: intake.ageCohort,
    preferredFormat,
    personaTags,
    keywords,
    soulTraits,
    genderIdentity,
    pronouns,
    householdSummary,
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
      source: 'stored',
    };
    best = bundle;
    source = 'fallback';
    bestScore = 5;
  }

  const personalizedBundle = personalizeBundle(best, {
    soulTraits: personalization.soulTraits,
    ageCohort: personalization.cohort,
    genderIdentity: personalization.genderIdentity,
    pronouns: personalization.pronouns,
    householdSummary: personalization.householdSummary,
  });

  const placeholders = normalizeBlankConfig(intake.prefs || {}, {
    defaultLabel: personalization.familyName ? `${personalization.familyName} Blank Magnet` : 'Blank Magnet',
    defaultDescription: personalization.householdSummary
      ? `Blank magnet reserved for ${personalization.householdSummary}.`
      : 'Intentionally left blank so the household can write in custom rhythms.',
  });
  const blankRequests = expandBlankRequests(placeholders);
  const personalizedRequests = toRequests(personalizedBundle, personalization);
  const baseRequests = personalizedRequests.length ? personalizedRequests : buildFallbackIconRequests(intake);
  const combinedRequests = dedupeRequests([...baseRequests, ...blankRequests]);
  const format = personalization.preferredFormat;
  const helpers = buildHelperTasks({
    format,
    personaTags: personalization.personaTags,
    keywords: personalization.keywords,
    bundleName: personalizedBundle.name,
    iconCount: combinedRequests.length,
    blankCount: blankRequests.length,
  });

  const bundleWithSource = { ...personalizedBundle, source };

  const plan: MagnetBundlePlan = {
    bundle: bundleWithSource,
    requests: combinedRequests,
    helpers,
    personalization,
    keywords: personalization.keywords,
    format,
    source,
    placeholders,
  };

  plan.layout = await generateBundleLayout(intake, plan, opts);

  await trackBundleLibraryVersion(bundleWithSource, personalization, opts);

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

export interface BundleMergeSection {
  title: string;
  category: string;
  description?: string;
  icons: BundleIconDefinition[];
}

export interface PrintableBundleSheet {
  id: string;
  name: string;
  summary: string;
  sections: BundleMergeSection[];
}

export interface ReusableBundleSuggestion {
  bundle: StoredMagnetBundle & { source?: 'stored' | 'generated' | 'fallback' };
  versionId: string;
  score: number;
  message: string;
}

export async function suggestReusableBundle(
  profile: ReuseProfile,
  opts: BundleModuleOptions = {}
): Promise<ReusableBundleSuggestion | null> {
  const libraryPath = opts.libraryPath || BUNDLE_LIBRARY_PATH;
  const store = await loadBundleLibrary(libraryPath);
  if (!store.bundles.length) return null;

  let best: { entry: BundleLibraryEntry; version: BundleLibraryVersion; score: number } | null = null;
  for (const entry of store.bundles) {
    for (const version of entry.versions) {
      const score = scoreLibraryMatch(entry, version, profile);
      if (!best || score > best.score) {
        best = { entry, version, score };
      }
    }
  }

  if (!best || best.score === 0) return null;

  const householdNote = profile.householdSummary ? ` (${profile.householdSummary})` : '';
  const message = `Found a ${best.entry.name}${householdNote ? householdNote : ''} bundle from your blueprint. Want to reuse or tweak it?`;

  return {
    bundle: best.version.bundle,
    versionId: best.version.id,
    score: best.score,
    message,
  };
}

export function mergeBundles(
  bundles: StoredMagnetBundle[],
  profile: PersonalizationProfile = {},
  sheetName?: string
): PrintableBundleSheet {
  if (!Array.isArray(bundles) || !bundles.length) {
    throw new Error('mergeBundles requires at least one bundle');
  }

  const personalizedBundles = bundles.map((bundle) => personalizeBundle(bundle, profile));
  const traitTitle = buildTraitTitle(profile.soulTraits);
  const defaultName = traitTitle ? `${traitTitle} Magnet Blend` : 'Custom Magnet Blend';
  const name = sheetName || defaultName;
  const summaryParts: string[] = [];
  if (profile.householdSummary) summaryParts.push(`Household: ${profile.householdSummary}.`);
  if (traitTitle) summaryParts.push(`Soul traits: ${traitTitle}.`);
  const summary = summaryParts.join(' ') || 'Combined bundles for a single printable sheet.';

  const seenIcons = new Set<string>();
  const sections: BundleMergeSection[] = personalizedBundles.map((bundle) => {
    const icons = bundle.icons.filter((icon) => {
      if (!icon.slug) return true;
      const key = icon.slug.toLowerCase();
      if (seenIcons.has(key)) return false;
      seenIcons.add(key);
      return true;
    });
    return {
      title: bundle.name,
      category: bundle.category,
      description: bundle.description,
      icons,
    };
  });

  return {
    id: `merged-${slugify(`${name}-${Date.now()}`)}`,
    name,
    summary,
    sections,
  };
}
