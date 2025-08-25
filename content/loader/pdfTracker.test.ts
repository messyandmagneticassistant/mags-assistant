import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';

vi.mock('../../utils/config', () => ({ getConfig: vi.fn().mockResolvedValue({ botToken: 'token' }) }));
vi.mock('../../utils/order-log', () => ({ logPDFStatus: vi.fn() }));
vi.mock('../../lib/telegram', () => ({ tgSend: vi.fn().mockResolvedValue({ ok: true }) }));

describe('trackPDFStatus', () => {
  beforeEach(async () => {
    await fs.mkdir('data', { recursive: true });
  });

  it('Detect incomplete PDF and re-run generation automatically after 6h', async () => {
    const userId = 'user1';
    const status = {
      [userId]: { status: 'pending', pdfPath: '', timestamp: Date.now() - 7 * 60 * 60 * 1000 },
    };
    await fs.writeFile('data/reading-status.json', JSON.stringify(status));
    const mod = await import('./pdfTracker');
    vi.spyOn(mod, 'generatePDF').mockResolvedValue(undefined);
    const res = await mod.trackPDFStatus(userId);
    expect(res).toEqual({ success: false, regenerated: true });
    const { logPDFStatus } = await import('../../utils/order-log');
    expect((logPDFStatus as any)).toHaveBeenCalled();
  });
});
