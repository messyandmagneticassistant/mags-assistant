// scripts/drive.ts
// Minimal Google Drive helpers

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

function extractId(input: string): string {
  const match = input.match(/[a-zA-Z0-9_-]{10,}/g);
  return match ? match[0] : input;
}

/**
 * List files in the raw drive folder. This is a placeholder that
 * currently returns an empty list; integrate Google Drive API here.
 */
export async function listRawFiles(folder: string): Promise<DriveFile[]> {
  const id = extractId(folder);
  console.log(`[drive] listing files for folder ${id}`);
  // TODO: use Google Drive API to fetch files
  return [];
}
