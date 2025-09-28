const runtimeEnv: Record<string, any> =
  (typeof globalThis !== "undefined" &&
    ((globalThis as any).__ENV__ || (globalThis as any).ENV || (globalThis as any))) ||
  {};

export function getConfig(key: string) {
  if (key in runtimeEnv) {
    return runtimeEnv[key];
  }

  if (typeof process !== "undefined" && process.env && key in process.env) {
    return process.env[key];
  }

  return undefined;
}

export const TELEGRAM_BOT_TOKEN = getConfig("TELEGRAM_BOT_TOKEN");
export const TELEGRAM_CHAT_ID = getConfig("TELEGRAM_CHAT_ID");
