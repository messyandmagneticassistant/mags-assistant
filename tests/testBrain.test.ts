import { describe, expect, it } from 'vitest';

import { readBrain } from '../brain/readBrain';

describe('brain/readBrain', () => {
  it('parses the brain markdown front matter into JSON', async () => {
    const brain = await readBrain();

    expect(brain).toBeTruthy();
    expect(brain).toHaveProperty('version', 'v1');
    expect(brain).toHaveProperty('profile');

    const profile = brain.profile as Record<string, unknown>;
    expect(profile.name).toBe('Maggie');
    expect(profile).toHaveProperty('subdomains');

    const threadState = brain.threadState as Record<string, unknown>;
    expect(threadState.kvKey).toBe('PostQ:thread-state');
    expect(threadState.workflow).toContain('seed-kv.yml');
  });

  it('includes maggie logic and soul blueprint sections for downstream sync', async () => {
    const brain = await readBrain();

    expect(brain).toHaveProperty('maggieLogic');
    expect(Array.isArray((brain.maggieLogic as any).dailyLoop)).toBe(true);
    expect(brain).toHaveProperty('soulBlueprint');
    expect(Array.isArray((brain.soulBlueprint as any).guidingPrinciples)).toBe(true);
  });
});
