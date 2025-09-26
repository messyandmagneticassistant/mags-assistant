import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveMagnetBundlePlan } from '../src/fulfillment/magnet-bundles';
import { generateMagnetBundle } from '../maggie/core/generateMagnetBundle';
import type { NormalizedIntake } from '../src/fulfillment/types';

async function tempRuntimeFile(name: string) {
  const file = path.join(os.tmpdir(), name);
  await fs.writeFile(file, '[]').catch(() => fs.writeFile(file, '[]'));
  return file;
}

describe('magnet bundle plan', () => {
  let runtimePath: string;

  beforeEach(async () => {
    runtimePath = await tempRuntimeFile(`magnet-test-${Date.now()}.json`);
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

    const plan = await resolveMagnetBundlePlan(intake, { runtimePath, allowPersistence: false });

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

    const plan = await resolveMagnetBundlePlan(intake, { runtimePath, allowPersistence: false });

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

    const plan = await resolveMagnetBundlePlan(intake, { runtimePath, allowPersistence: false });

    const labels = plan.requests.map((req) => req.label.toLowerCase());
    expect(labels.some((label) => label.includes('garcia'))).toBe(true);
  });
});

describe('generateMagnetBundle', () => {
  it('creates an MG solo mom bundle with projector kids cues', async () => {
    const bundle = await generateMagnetBundle(
      {
        id: 'memphis',
        name: 'Memphis',
        household: 'Solo household',
        householdRole: 'Solo Mom',
        humanDesignType: 'Manifesting Generator',
        lifeType: 'Wellness',
        children: [{ name: 'River', age: 'child', humanDesignType: 'Projector' }],
        quizTags: ['high sensitivity'],
        customNeeds: ['adhd'],
      },
      { persist: false }
    );

    expect(bundle.name).toMatch(/MG/i);
    expect(bundle.name).toMatch(/Solo Mom/i);
    const iconLabels = bundle.icons.map((icon) => icon.label);
    expect(iconLabels).toContain('Water Intake');
    expect(iconLabels).toContain('Temple Time');
    expect(iconLabels).toContain('Quiet Reset');
    expect(iconLabels.some((label) => /bedtime/i.test(label))).toBe(true);
  });

  it('honors soul blueprint traits like Virgo Moon and Life Path 3', async () => {
    const bundle = await generateMagnetBundle(
      {
        id: 'virgo-moon',
        name: 'Atlas',
        household: 'Creative household',
        householdRole: 'Parent',
        humanDesignType: 'Projector',
        soulBlueprint: {
          moon: 'Virgo Moon',
          lifePath: 'Life Path 3',
        },
        lifeType: 'Creative Studio',
      },
      { persist: false }
    );

    const labels = bundle.icons.map((icon) => icon.label);
    expect(labels).toContain('Tidy Space');
    expect(labels).toContain('Creative Time');
  });

  it('adds helper directives when the icon list is short', async () => {
    const bundle = await generateMagnetBundle(
      {
        id: 'minimal',
        name: 'Nova',
        householdRole: 'Elder Support',
        humanDesignType: 'Reflector',
        lifeType: 'Care',
        customNeeds: ['sensory'],
      },
      { persist: false, minIcons: 3 }
    );

    expect(bundle.icons.length).toBeGreaterThanOrEqual(3);
    expect(bundle.helpers.length).toBeGreaterThan(0);
    expect(bundle.helpers[0].instructions).toMatch(/Bundle "/);
  });
});
