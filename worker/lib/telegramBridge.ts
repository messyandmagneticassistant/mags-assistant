import type { Env } from './env';

export type SendTelegramResult = {
  ok: boolean;
  status?: number;
  body?: any;
};

export type SendTelegramFn = (
  message: string,
  context: { env: Env }
) => Promise<SendTelegramResult>;

let cachedSendTelegram: Promise<SendTelegramFn> | null = null;

export async function getSendTelegram(): Promise<SendTelegramFn> {
  if (!cachedSendTelegram) {
    cachedSendTelegram = (async () => {
      // @ts-ignore - implemented in shared application runtime
      const mod = await import('../../src/' + 'utils/telegram');
      return (mod.sendTelegram ?? mod.default) as SendTelegramFn;
    })();
  }

  return cachedSendTelegram;
}
