import { describe, it, expect, vi } from 'vitest';
import { listRecentDonations, recordDonation } from '../src/donors/notion';

describe('donors/notion', () => {
  it('recordDonation posts to Notion', async () => {
    const mock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', mock as any);
    await recordDonation({ name: 'A', email: 'a@example.com', amount: 1, intent: 'test' }, {
      NOTION_API_KEY: 'k',
      NOTION_DB_ID: 'd',
    });
    expect(mock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('listRecentDonations parses output', async () => {
    const mock = vi.fn().mockResolvedValue({
      json: async () => ({
        results: [
          {
            properties: {
              Name: { title: [{ plain_text: 'Alice' }] },
              Amount: { number: 10 },
              Intent: { rich_text: [{ plain_text: 'Love' }] },
              Created: { date: { start: '2024-01-01' } },
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mock as any);
    const res = await listRecentDonations(1, { NOTION_API_KEY: 'k', NOTION_DB_ID: 'd' });
    expect(res[0].name).toBe('Alice');
    expect(res[0].amount).toBe(10);
    vi.unstubAllGlobals();
  });
});
