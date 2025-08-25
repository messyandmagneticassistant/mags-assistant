import { exec } from 'node:child_process';
import path from 'path';

export async function processWithCapCut(videoPath: string, exportPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = `capcut-cli render "${videoPath}" --template trending --output "${exportPath}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('[CapCut] Failed:', stderr);
        return reject(error);
      }
      const outputFile = path.join(exportPath, 'output.mp4');
      resolve(outputFile);
    });
  });
}