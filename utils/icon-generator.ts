import path from 'path';
import { promises as fs } from 'fs';

import { logErrorToSheet } from '../lib/maggieLogs';
import { runMaggieTaskWithFallback } from '../fallback';

export async function createCustomIconSheet(userId: string, icons: string[]): Promise<string> {
  const baseDir = path.resolve('data', 'icon-sheets', userId);
  await fs.mkdir(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `icons-${Date.now()}.json`);
  const payload = { userId, icons };

  try {
    const content = {
      generatedAt: new Date().toISOString(),
      icons,
    };
    await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
    return `file://${filePath}`;
  } catch (err) {
    const fallback = await runMaggieTaskWithFallback('icon', payload);
    const fallbackPath = path.join(baseDir, `icons-fallback-${Date.now()}.json`);
    await fs.writeFile(
      fallbackPath,
      JSON.stringify(
        {
          provider: fallback.provider,
          payload,
          output: fallback.output,
          attempts: fallback.attempts,
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
    await logErrorToSheet({
      module: 'IconGeneration',
      error: err,
      recovery: `fallback:${fallback.provider}`,
    });
    return `file://${fallbackPath}`;
  }
}
