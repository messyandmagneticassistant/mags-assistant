import { exec } from 'child_process';

export async function detectLocalCapCut(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('which capcut-cli', (err, stdout) => {
      resolve(Boolean(stdout && !err));
    });
  });
}