import path from 'path';
import { promises as fs } from 'fs';
import { createCustomIconSheet } from '../utils/icon-generator';

export type MagnetFormat =
  | 'pdf'
  | 'svg'
  | 'vinyl'
  | 'printable'
  | 'cling'
  | 'digital'
  | 'svg-sheet';

interface MagnetKitOptions {
  userId: string;
  icons: string[];
  format: MagnetFormat;
}

/**
 * Create a full magnet kit for a user. This will generate an icon sheet
 * in the requested format and place the result in a user-specific folder.
 */
export async function createMagnetKit(opts: MagnetKitOptions) {
  const { userId, icons, format } = opts;
  const baseDir = path.join('/tmp', 'magnet-kits', userId);
  await fs.mkdir(baseDir, { recursive: true });

  const sheetLink = await createCustomIconSheet(userId, icons);
  const ext = format === 'pdf' || format === 'printable' ? 'pdf' : 'svg';
  const file = path.join(baseDir, `magnet-kit.${ext}`);
  await fs.writeFile(file, `Generated from ${sheetLink}`);

  return {
    format,
    link: `file://${file}`,
  };
}
