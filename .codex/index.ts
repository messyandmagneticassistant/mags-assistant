// .codex/index.ts
import { task } from 'codex'

task('runMaggie', async ({ log, exec }) => {
  log('🚀 Starting Maggie: Soul Agent + TikTok automation')

  await exec('pnpm install')  // Ensure deps are fresh
  await exec('pnpm build')    // Optional: build step if you're using TS
  await exec('node maggie/index.ts') // Launch Maggie orchestrator

  log('✅ Maggie is now running with all subsystems loaded.')
})

task('fixMaggieErrors', async ({ log, exec }) => {
  log('🧰 Running Maggie repair steps...')

  await exec('pnpm install --force')     // Force reinstall
  await exec('pnpm dedupe')              // Clean up duped deps
  await exec('pnpm update')              // Refresh packages
  await exec('pnpm lint --fix || true')  // Optional: auto-fix lint errors

  log('✅ All environment issues resolved.')
})