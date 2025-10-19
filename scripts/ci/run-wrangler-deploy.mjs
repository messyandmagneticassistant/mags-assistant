#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_ATTEMPTS = Number(process.env.DEPLOY_MAX_ATTEMPTS || '2');
const RETRY_DELAY_MS = Number(process.env.DEPLOY_RETRY_DELAY_MS || '15000');
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
  /gateway timeout/i,
  /Status\s5\d{2}/i,
  /blob/i,
  /hydration/i,
  /VERCEL_TIMEOUT/i,
  /deployment failed to become active/i,
  /NETWORK_ERROR/i,
];

const args = process.argv.slice(2);
let configFile: string | null = null;
const passthroughArgs: string[] = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--config' || arg === '-c') {
    configFile = args[i + 1] ?? null;
    i += 1;
  } else {
    passthroughArgs.push(arg);
  }
}

const commandArgs = ['dlx', 'wrangler', 'deploy'];
if (configFile) {
  commandArgs.push('--config', configFile);
}
if (passthroughArgs.length) {
  commandArgs.push(...passthroughArgs);
}

function collectOutput(stream?: string): string {
  return stream ? stream.toString() : '';
}

function writeEnv(name: string, value: string) {
  const target = process.env.GITHUB_ENV;
  if (!target) return;
  appendFileSync(target, `${name}<<EOF\n${value}\nEOF\n`, 'utf8');
}

function looksTransient(output: string): boolean {
  if (!output) return false;
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(output)) return true;
  }
  const extraPatterns = (process.env.DEPLOY_TRANSIENT_PATTERNS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const raw of extraPatterns) {
    try {
      const pattern = new RegExp(raw, 'i');
      if (pattern.test(output)) return true;
    } catch {
      // ignore invalid regex
    }
  }
  return false;
}

async function runDeployAttempt(attempt: number) {
  console.log(`[deploy] Attempt ${attempt}: pnpm ${commandArgs.join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn('pnpm', commandArgs, { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function buildErrorSummary(attempts) {
  if (!attempts.length) return 'Unknown deployment error';
  const last = attempts[attempts.length - 1];
  const parts = [`Final attempt exited with code ${last.code ?? 'unknown'}.`];
  const stderr = collectOutput(last.stderr).trim();
  if (stderr) {
    parts.push('stderr:', stderr.slice(0, 3500));
  } else {
    const stdout = collectOutput(last.stdout).trim();
    if (stdout) {
      parts.push('stdout:', stdout.slice(0, 3500));
    }
  }
  return parts.join('\n');
}

async function main() {
  const maxAttempts = Number.isFinite(DEFAULT_ATTEMPTS) && DEFAULT_ATTEMPTS > 0 ? DEFAULT_ATTEMPTS : 2;
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runDeployAttempt(attempt);
    attempts.push(result);
    if (result.code === 0) {
      writeEnv('DEPLOY_FAIL_COUNT', '0');
      console.log('[deploy] Wrangler deploy completed successfully.');
      return process.exit(0);
    }

    const combined = `${collectOutput(result.stderr)}\n${collectOutput(result.stdout)}`;
    if (attempt < maxAttempts && looksTransient(combined)) {
      console.warn(`[deploy] Transient failure detected (attempt ${attempt}). Retrying in ${RETRY_DELAY_MS}ms...`);
      await delay(Math.max(0, RETRY_DELAY_MS));
      continue;
    }

    break;
  }

  const summary = buildErrorSummary(attempts);
  writeEnv('DEPLOY_FAIL_COUNT', String(attempts.length));
  writeEnv('DEPLOY_ERROR_SUMMARY', summary);
  console.error('[deploy] Deployment failed after retries.');
  console.error(summary);
  process.exit(attempts.at(-1)?.code ?? 1);
}

main().catch((err) => {
  const summary = err instanceof Error ? err.message : String(err);
  writeEnv('DEPLOY_FAIL_COUNT', '1');
  writeEnv('DEPLOY_ERROR_SUMMARY', summary);
  console.error('[deploy] Unexpected error running deploy script', err);
  process.exit(1);
});
