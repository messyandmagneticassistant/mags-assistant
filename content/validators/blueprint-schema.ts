export type BlueprintTier = 'full' | 'mini' | 'lite' | 'realignment';

interface ValidationResult {
  sections: Record<string, string>;
  headings: string[];
}

const STANDARD_HEADINGS = [
  'Who You Are at Your Core',
  'Your Soul’s Purpose + Mission',
  'Your Gifts and Rare Talents',
  'Lessons, Struggles, and Healing Themes',
  'Soul Age and Collective Context',
  'Past Life Echoes and Patterns',
  'Love, Family, and Relationship Dynamics',
  'Career, Work, and Flow',
  'Daily Rhythm Alignment',
  'Your Psychic Senses',
  'Elemental Balance',
  'Aura + Chakra Profile',
  'What Makes You Stand Out',
  'Future Shifts + Energy Cycles',
  'Practical Integration + How to Use This',
  'Family + Household Overlay',
  'How to Know You’re On or Off Path',
  'Child-Friendly Version',
];

const REALIGN_REQUIRED = [
  'Why You’re Here',
  'What to Re-Align',
  'Fast Wins',
  'Your Rhythm Reminders',
  'When You Feel Off',
];

const REALIGN_OPTIONAL = [
  'Relationship/Household',
  'Work Focus',
  'Child-Friendly Version',
];

export function validateBlueprint(
  markdown: string,
  tier: BlueprintTier
): ValidationResult {
  const sections: Record<string, string> = {};
  const headings: string[] = [];
  const regex = /^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s+|$)/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const heading = match[1].trim();
    const body = match[2].trim();
    if (sections[heading]) {
      throw new Error(`Duplicate heading: ${heading}`);
    }
    if (!body) {
      throw new Error(`Empty section: ${heading}`);
    }
    sections[heading] = body;
    headings.push(heading);
  }

  if (tier === 'realignment') {
    // ensure required headings exist and in order
    let lastIndex = -1;
    for (const h of REALIGN_REQUIRED) {
      const idx = headings.indexOf(h);
      if (idx === -1) throw new Error(`Missing heading: ${h}`);
      if (idx < lastIndex) throw new Error(`Heading out of order: ${h}`);
      lastIndex = idx;
    }
    const allowed = new Set([...REALIGN_REQUIRED, ...REALIGN_OPTIONAL]);
    for (const h of headings) {
      if (!allowed.has(h)) throw new Error(`Unexpected heading: ${h}`);
    }
  } else {
    for (let i = 0; i < STANDARD_HEADINGS.length; i++) {
      const expected = STANDARD_HEADINGS[i];
      const actual = headings[i];
      if (actual !== expected) {
        throw new Error(`Heading mismatch at position ${i}: expected ${expected} got ${actual}`);
      }
    }
  }

  return { sections, headings };
}
