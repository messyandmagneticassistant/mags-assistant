import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveMagnetBundlePlan } from '../src/fulfillment/magnet-bundles';
import type { NormalizedIntake } from '../src/fulfillment/types';

async function tempFile(name: string, initial: string) {
  const file = path.join(os.tmpdir(), name);
  await fs.writeFile(file, initial).catch(() => fs.writeFile(file, initial));
  return file;
}

describe('magnet bundle plan', () => {
  let runtimePath: string;
  let libraryPath: string;

  beforeEach(async () => {
    runtimePath = await tempFile(`magnet-test-${Date.now()}.json`, '[]');
    libraryPath = await tempFile(`magnet-library-${Date.now()}.json`, '[]');
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
      trackLibrary: false,
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
      trackLibrary: false,
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
      trackLibrary: false,
    });

    const labels = plan.requests.map((req) => req.label.toLowerCase());
    expect(labels.some((label) => label.includes('garcia'))).toBe(true);
  });

  it('infuses soul trait language when blueprint traits are present', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        focus: 'Morning energy reset',
        soul_traits: ['MG'],
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      trackLibrary: false,
    });

    expect(plan.bundle.name).toMatch(/Move \+ Flow/i);
    expect(plan.requests.some((req) => /Move \+ Flow/i.test(req.label))).toBe(true);
  });

  it('merges selected bundles into a combined sheet with sections', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        selected_bundles: ['Wellness Reset', 'Family Rhythm Balancer'],
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      trackLibrary: false,
    });

    expect(plan.bundle.name).toMatch(/Custom Merge/i);
    expect(plan.mergedFrom).toEqual(
      expect.arrayContaining(['Wellness Reset', 'Family Rhythm Balancer'])
    );
    const sections = new Set(plan.requests.map((req) => req.section).filter(Boolean));
    expect(sections.size).toBeGreaterThanOrEqual(2);
  });

  it('suggests reuse when a similar bundle exists in the library', async () => {
    const existingEntry = [
      {
        id: 'morning-reset',
        name: 'Morning Reset',
        category: 'Wellness',
        keywords: ['morning', 'reset'],
        personaTags: ['wellness'],
        format: 'printable',
        source: 'stored',
        createdAt: new Date().toISOString(),
        email: 'test@example.com',
      },
    ];
    await fs.writeFile(libraryPath, JSON.stringify(existingEntry));

    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        focus: 'Morning reset flow',
      },
    };

    const plan = await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    expect(plan.reuseSuggestion).toMatch(/Morning Reset/);
  });

  it('records bundle plans into the bundle library when tracking is enabled', async () => {
    const intake: NormalizedIntake = {
      ...baseIntake(),
      prefs: {
        focus: 'Household reset',
      },
    };

    await resolveMagnetBundlePlan(intake, {
      runtimePath,
      allowPersistence: false,
      libraryPath,
    });

    const stored = JSON.parse(await fs.readFile(libraryPath, 'utf8'));
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0].email).toBe('test@example.com');
  });
});
