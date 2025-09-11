#!/usr/bin/env node
import { execSync } from 'node:child_process';

try {
  execSync("git config merge.worker-health.driver 'node scripts/resolve-worker-health-conflict.js %A'");
  execSync("git config merge.worker-health.name 'worker health merge driver'");
  console.log('Configured worker/health.ts merge driver');
} catch (err) {
  console.error(err);
  process.exit(1);
}
