import { describe, it, expect, vi } from 'vitest';
import { ensureTelegramWebhook } from './telegramFallback';

describe('ensureTelegramWebhook', () => {
  it('triggers fallback email when Telegram is unreachable', async () => {
    const order = { id: 'o1', email: 'test@example.com' };
    const sendTelegram = vi.fn().mockResolvedValue({ ok: false });
    const emailSender = vi.fn().mockResolvedValue(undefined);
    const logger = vi.fn().mockResolvedValue(undefined);
    const res = await ensureTelegramWebhook(order, { sendTelegram, emailSender, logger });
    expect(res.fallback).toBe(true);
    expect(emailSender).toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(order.email, order.id, 'sent');
  });
});
