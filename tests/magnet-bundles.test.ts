import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  resolveMagnetBundlePlan,
  personalizeBundle,
  mergeBundles,
  suggestReusableBundle,
} from '../src/fulfillment/magnet-bundles';
import type { NormalizedIntake } from '../src/fulfillment/types';

async function tempRuntimeFile(name: string) {
  const file = path.join(os.tmpdir(), name);
  await fs.writeFile(file, '[]').catch(() => fs.writeFile(file, '[]'));
  return file;
}

async function tempLibraryFile(name: string) {
  const file = path.join(os.tmpdir(), name);
  await fs
    .writeFile(file, JSON.stringify({ bundles: [] }))
    .catch(() => fs.writeFile(file, JSON.stringify({ bundles: [] })));
  return file;
}

describe('magnet bundle plan', () => {
  let runtimePath: string;
  let libraryPath: string;

  beforeEach(async () => {
    runtimePath = await tempRuntimeFile(`magnet-test-${Date.now()}.json`);
    libraryPath = await tempLibraryFile(`magnet-library-${Date.now()}.json`);
  });

  function baseIntake(): NormalizedIntake {
    return {
      source: 'tally',
      email: 'test@example.com',
      tier: 'lite',
      addOns: [],
      prefs: {},
      customer: { name: 'Test User', householdMembers: [] },
    } as NormalizedIntake;
  }

  it('selects a stored family bundle when household cues are present', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        household_type: 'Family homeschool crew',
        focus: 'Play + morning basket',
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    expect(plan.bundle.id).toBe('family-rhythm');
    expect(plan.requests.length).toBeGreaterThan(0);
    const labels = plan.requests.map((r) => r.label);
    expect(labels.some((label) => /Morning Basket/i.test(label))).toBe(true);
    expect(plan.helpers.some((helper) => helper.name === 'bundle-sorter')).toBe(true);
  });

  it('falls back to baseline icons when no bundle matches and AI is unavailable', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        focus: 'Completely unique scenario with no match',
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    expect(plan.requests.length).toBeGreaterThan(0);
    expect(plan.source).toBe('fallback');
  });

  it('personalizes labels when family name is provided', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        household_type: 'Solo mom household',
        family_name: 'Garcia',
        focus: 'Laundry rhythm reset',
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    const labels = plan.requests.map((req) => req.label.toLowerCase());
    expect(labels.some((label) => label.includes('garcia'))).toBe(true);
  });

  it('includes blank magnet placeholders when requested', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        blank_magnets: 2,
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    const blanks = plan.requests.filter((req) => req.isBlank);
    expect(blanks.length).toBe(2);
    expect(plan.placeholders.length).toBeGreaterThan(0);
    expect(plan.layout).toBeDefined();
    expect(plan.layout?.sections.some((section) => /blank/i.test(section.title))).toBe(true);
  });

  it('personalizes a bundle name with soul traits and household summary', () => {
    const bundle = {
      id: 'morning-reset',
      name: 'Morning Reset',
      category: 'Wellness',
      description: 'Daily rhythm support.',
      icons: [
        { slug: 'sunrise', label: 'Morning Flow', description: 'Start the day with ease.', tags: ['morning'] },
      ],
    } as any;

    const personalized = personalizeBundle(bundle, {
      soulTraits: ['MG'],
      ageCohort: 'child',
      householdSummary: 'Parent + 3 Kids',
    });

    expect(personalized.name).toContain('Move + Flow');
    expect(personalized.name).toContain('Parent + 3 Kids');
    expect(personalized.icons[0].description.split(' ').length).toBeLessThanOrEqual(13);
  });

  it('merges bundles into printable sections without duplicate icons', () => {
    const bundleA = {
      id: 'family',
      name: 'Family Flow',
      category: 'Family',
      description: 'Family focused icons.',
      icons: [
        { slug: 'family-circle', label: 'Family Circle', description: 'Gather time.', tags: ['family'] },
        { slug: 'sunrise', label: 'Morning Flow', description: 'Morning reset.', tags: ['morning'] },
      ],
    } as any;
    const bundleB = {
      id: 'wellness',
      name: 'Wellness Glow',
      category: 'Wellness',
      description: 'Wellness icons.',
      icons: [
        { slug: 'sunrise', label: 'Sunrise Breath', description: 'Breath work.', tags: ['morning'] },
        { slug: 'evening-soften', label: 'Evening Soften', description: 'Wind down.', tags: ['evening'] },
      ],
    } as any;

    const sheet = mergeBundles([bundleA, bundleB], { soulTraits: ['Projector'] });
    expect(sheet.sections.length).toBe(2);
    const totalIcons = sheet.sections.reduce((acc, section) => acc + section.icons.length, 0);
    expect(totalIcons).toBe(3);
    expect(sheet.name).toContain('Guide + Glow');
  });

  it('suggests reusable bundles from the library', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        household_type: 'Family homeschool crew',
        focus: 'Morning reset with movement',
        soul_traits: 'MG',
      },
    };

    await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    const suggestion = await suggestReusableBundle(
      {
        soulTraits: ['MG'],
        keywords: ['morning'],
        personaTags: ['family'],
        householdSummary: 'Parent + 1 Kid',
        preferredCategory: 'Wellness',
      },
      { libraryPath }
    );

    expect(suggestion).not.toBeNull();
    expect(suggestion?.message).toMatch(/reuse or tweak/);
  });
});
