import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveMagnetBundlePlan } from '../src/fulfillment/magnet-bundles';
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
