import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { checkBrainDrift } from '../scripts/brainPing';

function createTempBrain(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
  const filePath = path.join(dir, 'brain.json');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('checkBrainDrift', () => {
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'acct_123',
    CLOUDFLARE_API_TOKEN: 'tok_123',
    CF_KV_NAMESPACE_ID: 'ns_123',
  } satisfies NodeJS.ProcessEnv;

  let files: string[] = [];

  beforeEach(() => {
    files = [];
  });

  afterEach(() => {
    for (const file of files) {
      try {
        fs.unlinkSync(file);
        fs.rmdirSync(path.dirname(file));
      } catch (err) {
        // ignore cleanup errors in CI environments
      }
    }
  });

  it('returns a matching report when remote payload equals local JSON', async () => {
    const payload = {
      lastUpdated: '2024-01-01T00:00:00.000Z',
      lastSynced: '2024-01-01T00:00:00.000Z',
      sample: 'ok',
    } satisfies Record<string, unknown>;
    const json = JSON.stringify(payload, null, 2);
    const localPath = createTempBrain(`${json}\n`);
    files.push(localPath);

    const fetchImpl = async () =>
      new Response(`${json}\n`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const report = await checkBrainDrift({ env, fetchImpl, canonicalPath: localPath });

    expect(report.matches).toBe(true);
    expect(report.remoteBytes).toBeGreaterThan(0);
    expect(report.localLastUpdated).toBe('2024-01-01T00:00:00.000Z');
    expect(report.remoteLastSynced).toBe('2024-01-01T00:00:00.000Z');
    expect(report.lastUpdatedSkewMinutes).toBe(0);
  });

  it('flags drift when remote JSON differs from local brain', async () => {
    const localPayload = {
      lastUpdated: '2024-01-01T00:00:00.000Z',
      lastSynced: '2024-01-01T00:00:00.000Z',
      status: 'local',
    } satisfies Record<string, unknown>;
    const remotePayload = {
      lastUpdated: '2024-01-02T00:00:00.000Z',
      lastSynced: '2024-01-02T00:00:00.000Z',
      status: 'remote',
    } satisfies Record<string, unknown>;

    const localJson = JSON.stringify(localPayload, null, 2);
    const remoteJson = JSON.stringify(remotePayload, null, 2);

    const localPath = createTempBrain(`${localJson}\n`);
    files.push(localPath);

    const fetchImpl = async () =>
      new Response(`${remoteJson}\n`, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const report = await checkBrainDrift({ env, fetchImpl, canonicalPath: localPath });

    expect(report.matches).toBe(false);
    expect(report.localLastUpdated).toBe('2024-01-01T00:00:00.000Z');
    expect(report.remoteLastUpdated).toBe('2024-01-02T00:00:00.000Z');
    expect(report.lastUpdatedSkewMinutes).toBe(1440);
  });
});
