import { runBrowserlessCapCut } from '../clients/capcut-browserless';

/**
 * Handles CapCut processing before upload.
 */
export async function processWithCapCut(
  rawPath: string,
  outDir: string
): Promise<string> {
  const finalPath = await runBrowserlessCapCut(rawPath, outDir);
  return finalPath;
}