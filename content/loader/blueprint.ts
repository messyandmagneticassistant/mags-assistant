import { readFileSync } from 'fs';
import path from 'path';
import { validateBlueprint, BlueprintTier } from '../validators/blueprint-schema';

export interface BlueprintLoaderOptions {
  childFriendly?: boolean;
}

const FILE_MAP: Record<BlueprintTier, string> = {
  full: 'full.md',
  mini: 'mini.md',
  lite: 'lite.md',
  realignment: 'realignment.md',
};

export function getBlueprintSections(
  tier: BlueprintTier,
  opts: BlueprintLoaderOptions = {}
): Record<string, string> {
  const file = FILE_MAP[tier];
  const filepath = path.join(__dirname, '..', 'fixtures', 'blueprint', file);
  const markdown = readFileSync(filepath, 'utf8');
  const { sections } = validateBlueprint(markdown, tier);
  if (!opts.childFriendly) {
    delete sections['Child-Friendly Version'];
  }
  return sections;
}

interface ReadingData {
  traits?: {
    hdType?: string;
    lifePath?: string;
    auraColor?: string;
    elements?: string[];
  };
  themes?: string[];
}

const TRAIT_ICON_TAGS: Record<string, string[]> = {
  Reflector: ['Rest Day', 'Alone Time', 'Open Energy'],
  Generator: ['Sacral Power', 'Daily Flow'],
  Manifestor: ['Initiate', 'Independence'],
  Projector: ['Guidance', 'Recognition'],
};

const ICON_CATEGORY_MAP: Record<string, string[]> = {
  'Rest Day': ['Wellness'],
  'Alone Time': ['Spiritual'],
  'Open Energy': ['Wellness'],
  'Sacral Power': ['Wellness'],
  'Daily Flow': ['Household'],
  Initiate: ['Spiritual'],
  Independence: ['Household'],
  Guidance: ['Household'],
  Recognition: ['Spiritual'],
};

/**
 * Generate a list of icon suggestions from a user's reading data.
 * This inspects core chart traits and themes, matching them to
 * predefined icon tags and magnet categories.
 */
export function generateIconBundleFromReading(reading: ReadingData) {
  const icons: Map<string, Set<string>> = new Map();

  const traits = reading.traits || {};
  Object.values(traits).forEach(traitValue => {
    if (!traitValue) return;
    const tags = TRAIT_ICON_TAGS[traitValue as keyof typeof TRAIT_ICON_TAGS];
    if (!tags) return;
    tags.forEach(tag => {
      const cats = ICON_CATEGORY_MAP[tag] || [];
      const set = icons.get(tag) || new Set<string>();
      cats.forEach(c => set.add(c));
      icons.set(tag, set);
    });
  });

  (reading.themes || []).forEach(theme => {
    const tags = TRAIT_ICON_TAGS[theme];
    if (tags) {
      tags.forEach(tag => {
        const cats = ICON_CATEGORY_MAP[tag] || [];
        const set = icons.get(tag) || new Set<string>();
        cats.forEach(c => set.add(c));
        icons.set(tag, set);
      });
    }
  });

  return Array.from(icons.entries()).map(([tag, cats]) => ({
    tag,
    categories: Array.from(cats),
  }));
}
