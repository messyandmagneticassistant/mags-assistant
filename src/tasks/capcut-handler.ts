// src/tasks/capcut-handler.ts
import { log } from '../shared/logger';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

// Utility to download CapCut video from known link
export async function tryDownloadCapCutVersion(videoPath: string): Promise<string | null> {
  const capcutUrl = extractCapCutUrl(videoPath);
  if (!capcutUrl) return null;

  const outputPath = videoPath.replace(/\.mp4$/, '-capcut.mp4');

  return new Promise((resolve) => {
    const command = `yt-dlp -o "${outputPath}" "${capcutUrl}"`;
    log(`[capcut] Attempting download: ${command}`);
    exec(command, (err, stdout, stderr) => {
      if (err) {
        log(`[capcut] Download failed: ${stderr}`);
        return resolve(null);
      }
      log(`[capcut] Success: ${outputPath}`);
      resolve(outputPath);
    });
  });
}

// Try to detect a CapCut overlay URL
function extractCapCutUrl(filePath: string): string | null {
  const metaPath = filePath.replace(/\.mp4$/, '.meta.json');
  if (!fs.existsSync(metaPath)) return null;

  try {
    const json = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return json.capcut_url || null;
  } catch {
    return null;
  }
}