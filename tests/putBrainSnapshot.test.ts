import { describe, expect, it, vi, beforeEach } from 'vitest';

const putConfigMock = vi.hoisted(() => {
  const fn = vi.fn<
    (key: string, value: unknown, options: Record<string, unknown>) => Promise<{ ok: true }>
  >();
  fn.mockResolvedValue({ ok: true });
  return fn;
});

const getBrainMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock('../lib/kv', () => ({
  putConfig: putConfigMock,
}));

vi.mock('../lib/getBrain', () => ({
  getBrain: getBrainMock,
}));

const SAMPLE_BRAIN = `---\nname: Example Brain\nrole: assistant\n---\nThis is the brain content.`;

describe('putBrainSnapshot', () => {
  beforeEach(() => {
    putConfigMock.mockClear();
    getBrainMock.mockReset();
  });

  it('stores the snapshot under the brain/latest KV key', async () => {
    getBrainMock.mockResolvedValueOnce(SAMPLE_BRAIN);

    const { putBrainSnapshot } = await import('../lib/putConfig');

    const env = {
      CF_ACCOUNT_ID: 'acct_123',
      CF_KV_POSTQ_NAMESPACE_ID: 'ns_456',
      CLOUDFLARE_API_TOKEN: 'tok_789',
    };

    const result = await putBrainSnapshot(env);

    expect(getBrainMock).toHaveBeenCalledTimes(1);
    expect(putConfigMock).toHaveBeenCalledTimes(1);

    const [key, value, options] = putConfigMock.mock.calls[0];

    expect(key).toBe('brain/latest');
    expect(options).toMatchObject({
      accountId: 'acct_123',
      namespaceId: 'ns_456',
      apiToken: 'tok_789',
      contentType: 'application/json',
    });

    const parsed = JSON.parse(value as string);
    expect(parsed).toMatchObject({
      name: 'Example Brain',
      role: 'assistant',
      lastUpdated: expect.any(String),
      lastSynced: expect.any(String),
    });

    expect(parsed.lastUpdated).toBe(parsed.lastSynced);

    expect(result).toMatchObject({
      ok: true,
      bytes: expect.any(Number),
      syncedAt: expect.any(String),
    });
  });
});
