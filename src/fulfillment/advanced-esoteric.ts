import { readFileSync } from 'fs';
import path from 'path';
import type { NormalizedIntake } from './types';

export interface AdvancedEsotericSystem {
  id: string;
  label: string;
  icon: string;
  narrative: string;
  integration: string;
  mediumship: string;
  rhythmTieIn: string;
  childTone?: string;
  skipForChild?: boolean;
  mandatoryMentions?: string[];
}

interface AdvancedSectionMeta {
  title: string;
  introduction: string;
  mediumshipStyle?: string;
  rhythmIntegration?: string;
  evidentialExamples?: string[];
}

interface AdvancedSummaryMeta {
  calloutHeading: string;
  instructions: string;
}

export interface AdvancedMagicCodeIcon {
  symbol: string;
  label: string;
  meaning: string;
}

interface AdvancedMagicCodesMeta {
  title: string;
  intro: string;
  icons: AdvancedMagicCodeIcon[];
}

interface AdvancedAutomationMeta {
  includeTiers?: string[];
  childRules?: {
    skipSystems?: string[];
    tone?: string;
  };
  fallbacks?: {
    missingBirth?: string;
  };
}

export interface AdvancedEsotericConfig {
  section: AdvancedSectionMeta;
  systems: AdvancedEsotericSystem[];
  summary: AdvancedSummaryMeta;
  magicCodes: AdvancedMagicCodesMeta;
  automation?: AdvancedAutomationMeta;
  upgradeNote?: string;
  helperAgents?: Record<string, string>;
}

let cachedConfig: AdvancedEsotericConfig | null | undefined;

export function loadAdvancedEsotericConfig(): AdvancedEsotericConfig | null {
  if (cachedConfig !== undefined) return cachedConfig || null;
  try {
    const filePath = path.resolve(
      process.cwd(),
      'soul-blueprint',
      'tiers',
      'full',
      'expansions',
      'advanced-esoteric.json'
    );
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AdvancedEsotericConfig;
    cachedConfig = parsed;
    return parsed;
  } catch (err) {
    console.warn('[advanced-esoteric] unable to load advanced esoteric config:', err);
    cachedConfig = null;
    return null;
  }
}

function normalizeCohort(value?: string | null): 'child' | 'teen' | 'adult' | 'elder' | undefined {
  if (!value) return undefined;
  const text = value.toLowerCase();
  if (text.includes('child')) return 'child';
  if (text.includes('teen')) return 'teen';
  if (text.includes('elder') || text.includes('senior')) return 'elder';
  if (text.includes('adult')) return 'adult';
  return undefined;
}

export function resolveCohortFromIntake(intake: NormalizedIntake): 'child' | 'teen' | 'adult' | 'elder' | undefined {
  if (intake.ageCohort) return intake.ageCohort;
  const prefs = intake.prefs || {};
  const cohortFields = [
    'cohort',
    'client_cohort',
    'age_group',
    'agegroup',
    'client_age_group',
    'recipient_age_group',
    'tier_cohort',
  ];
  for (const key of cohortFields) {
    const value = prefs[key];
    if (typeof value === 'string') {
      const normalized = normalizeCohort(value);
      if (normalized) return normalized;
    }
  }
  const ageFields = ['age', 'client_age', 'recipient_age', 'child_age'];
  for (const key of ageFields) {
    const value = prefs[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value < 13) return 'child';
      if (value < 18) return 'teen';
      if (value >= 65) return 'elder';
      return 'adult';
    }
    if (typeof value === 'string') {
      const num = parseInt(value, 10);
      if (!Number.isNaN(num)) {
        if (num < 13) return 'child';
        if (num < 18) return 'teen';
        if (num >= 65) return 'elder';
        return 'adult';
      }
    }
  }
  return undefined;
}

export function getActiveSystems(
  config: AdvancedEsotericConfig,
  opts: { cohort?: 'child' | 'teen' | 'adult' | 'elder' } = {}
): AdvancedEsotericSystem[] {
  const skip = new Set<string>();
  if (opts.cohort === 'child') {
    const skipSystems = config.automation?.childRules?.skipSystems || [];
    for (const id of skipSystems) skip.add(id);
  }
  return config.systems.filter((system) => !skip.has(system.id));
}

export function describeSystemForPrompt(
  system: AdvancedEsotericSystem,
  opts: { cohort?: 'child' | 'teen' | 'adult' | 'elder' }
): string {
  const pieces = [system.narrative, system.integration, system.mediumship, system.rhythmTieIn];
  if (opts.cohort === 'child' && system.childTone) {
    pieces.push(system.childTone);
  }
  return pieces.filter(Boolean).join(' ');
}

export function summarizeMagicCodes(config: AdvancedEsotericConfig): string {
  return config.magicCodes.icons
    .map((icon) => `${icon.symbol} ${icon.label}: ${icon.meaning}`)
    .join('; ');
}

export function findMissingSystems(
  story: string,
  systems: AdvancedEsotericSystem[]
): AdvancedEsotericSystem[] {
  const text = story.toLowerCase();
  return systems.filter((system) => {
    const tokens = system.mandatoryMentions?.length ? system.mandatoryMentions : [system.label];
    return !tokens.some((token) => text.includes(token.toLowerCase()));
  });
}

export function hasMagicCodesLegend(story: string, config: AdvancedEsotericConfig): boolean {
  const lower = story.toLowerCase();
  if (lower.includes(config.magicCodes.title.toLowerCase())) return true;
  return config.magicCodes.icons.some((icon) => story.includes(icon.symbol));
}

export function buildMissingSystemsPrompt(
  systems: AdvancedEsotericSystem[],
  config: AdvancedEsotericConfig,
  opts: {
    cohort?: 'child' | 'teen' | 'adult' | 'elder';
  } = {}
): string {
  const lines: string[] = [];
  lines.push(
    'Provide narrative paragraphs to cover the remaining advanced soul systems that still need to be woven into the reading. Keep the tone consistent with the existing Full Soul Blueprint voice.'
  );
  for (const system of systems) {
    const desc = describeSystemForPrompt(system, { cohort: opts.cohort });
    lines.push(`System: ${system.label}. ${desc}`);
  }
  if (config.section.mediumshipStyle) {
    lines.push(`Mediumship style reminder: ${config.section.mediumshipStyle}`);
  }
  if (config.section.rhythmIntegration) {
    lines.push(`Tie each insight back to rhythm guidance: ${config.section.rhythmIntegration}`);
  }
  return lines.join('\n');
}

export function buildMagicCodesPrompt(config: AdvancedEsotericConfig): string {
  const legend = summarizeMagicCodes(config);
  return `Create a concise "${config.magicCodes.title}" legend using the following cues: ${legend}. Keep it playful and easy to skim.`;
}
