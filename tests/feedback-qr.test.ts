import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

import { addFeedbackQR, createMagnetKit, type BundlePdfLayout } from '../lib/magnet-kit';

const appendRowsMock = vi.fn();
const tgSendMock = vi.fn().mockResolvedValue({ ok: true });
const sheetMock = vi.fn().mockResolvedValue('file://sheet');

vi.mock('../lib/google', () => ({
  appendRows: (...args: any[]) => appendRowsMock(...args),
}));

vi.mock('../lib/telegram', () => ({
  tgSend: (...args: any[]) => tgSendMock(...args),
}));

vi.mock('../utils/icon-generator', () => ({
  createCustomIconSheet: (...args: any[]) => sheetMock(...args),
}));

describe('bundle feedback QR integration', () => {
  beforeEach(() => {
    appendRowsMock.mockClear();
    tgSendMock.mockClear();
    sheetMock.mockClear();
    process.env.BUNDLE_FEEDBACK_SHEET_ID = 'sheet-123';
    process.env.BUNDLE_FEEDBACK_URL = 'https://feedback.example.com/form';
  });

  afterEach(async () => {
    delete process.env.BUNDLE_FEEDBACK_SHEET_ID;
    delete process.env.BUNDLE_FEEDBACK_URL;
    await fs.rm(path.join('/tmp', 'magnet-kits', 'tester'), { recursive: true, force: true });
  });

  it('embeds a feedback QR block and logs creation when generating a PDF kit', async () => {
    const result = await createMagnetKit({
      userId: 'tester',
      icons: ['rise', 'reset'],
      format: 'pdf',
      bundleName: 'Tester Bundle',
      email: 'tester@example.com',
    });

    expect(result.feedbackLink).toMatch(/feedback\.example\.com/);
    expect(tgSendMock).toHaveBeenCalledTimes(1);
    expect(appendRowsMock).toHaveBeenCalledWith(
      'sheet-123',
      'BundleFeedback_Log!A2:D',
      expect.any(Array)
    );

    const loggedValues = appendRowsMock.mock.calls[0][2] as string[][];
    expect(loggedValues[0][1]).toBe('Tester Bundle');
    expect(loggedValues[0][2]).toBe('tester');

    const filePath = result.link.replace('file://', '');
    const raw = await fs.readFile(filePath, 'utf8');
    const layout = JSON.parse(raw) as BundlePdfLayout;
    expect(layout.feedback?.text).toBe('Scan to update your rhythm or request edits 🌀');
    expect(layout.feedback?.url).toMatch(/user_id=tester/);
    expect(layout.footer?.qr?.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('adds query parameters when injecting QR metadata', () => {
    const base: BundlePdfLayout = {
      format: 'pdf',
      icons: [],
      metadata: { userId: 'abc', bundleName: 'Demo', generatedAt: new Date().toISOString() },
    };

    const updated = addFeedbackQR(base, {
      feedbackUrl: 'https://example.com/feedback',
      userId: 'abc',
    });

    expect(updated.feedback?.url).toBe('https://example.com/feedback?user_id=abc');
    expect(updated.footer?.note).toContain('Scan to update your rhythm');
  });
});
