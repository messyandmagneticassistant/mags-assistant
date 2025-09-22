import { tgSend } from './telegram';
import { logErrorToSheet } from './maggieLogs.ts';
import { updatePuppeteerStatus } from './statusStore.ts';
import { runMaggieTaskWithFallback, type MaggieFallbackResult } from '../fallback';

export interface PuppeteerSelfHealOptions {
  moduleName?: string;
  fallbackTask?: string;
  payload?: Record<string, unknown>;
  notifyChatId?: string;
}

export interface SelfHealOutcome<T> {
  status: 'success' | 'fallback';
  result?: T;
  error?: string;
  fallback?: MaggieFallbackResult | null;
  attempts: number;
}

function summarizeError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return error.stack || error.message || 'Error with no message';
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function withPuppeteerSelfHeal<T>(
  operation: () => Promise<T>,
  options: PuppeteerSelfHealOptions = {}
): Promise<SelfHealOutcome<T>> {
  const moduleName = options.moduleName || 'Puppeteer';
  const fallbackTask = options.fallbackTask || 'puppeteer-recovery';
  const payload = options.payload || {};
  const attemptAt = new Date().toISOString();
  let attempt = 0;
  let lastError: unknown;

  while (attempt < 2) {
    attempt += 1;
    try {
      const result = await operation();
      await updatePuppeteerStatus({
        lastRunAt: attemptAt,
        status: 'success',
        attempts: attempt,
        error: null,
        fallbackModel: null,
        recoveryNotes: null,
      });
      return { status: 'success', result, attempts: attempt };
    } catch (err) {
      lastError = err;
      console.warn(`[self-heal] ${moduleName} attempt ${attempt} failed`, err);
    }
  }

  const errorMessage = summarizeError(lastError);
  let fallback: MaggieFallbackResult | null = null;
  try {
    fallback = await runMaggieTaskWithFallback(fallbackTask, payload);
  } catch (fallbackErr) {
    console.warn('[self-heal] fallback execution failed', fallbackErr);
  }

  const recoveryNotes: string[] = [`retry:${attempt}`];
  if (fallback) {
    recoveryNotes.push(`fallback:${fallback.provider}`);
  } else {
    recoveryNotes.push('fallback:unavailable');
  }

  await Promise.all([
    logErrorToSheet({
      module: moduleName,
      error: errorMessage,
      recovery: recoveryNotes.join(' → '),
      timestamp: attemptAt,
    }),
    updatePuppeteerStatus({
      lastRunAt: attemptAt,
      status: 'fail',
      attempts: attempt,
      error: errorMessage,
      fallbackModel: fallback?.provider || null,
      recoveryNotes: recoveryNotes.join(' → '),
    }),
    tgSend(
      `⚠️ ${moduleName} failure after retry.\nTime: ${attemptAt}\nError: ${errorMessage}${
        fallback?.provider ? `\nFallback: ${fallback.provider}` : ''
      }`,
      options.notifyChatId
    ).catch(() => undefined),
  ]);

  return { status: 'fallback', error: errorMessage, fallback, attempts: attempt };
}
