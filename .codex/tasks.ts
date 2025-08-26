import { task } from 'codex'

task('runMaggie', async ({ log, exec }) => {
  log('🚀 Starting Maggie: Soul Agent + TikTok automation')
  
  await exec('pnpm install') // make sure dependencies are installed
  await exec('pnpm build')   // or whatever your project uses
  await exec('node src/index.ts') // start the local Maggie logic

  log('✅ Maggie has been started.')
})

task('fixMaggieErrors', async ({ log, exec }) => {
  log('🛠️ Fixing Maggie environment errors...')
  
  await exec('pnpm install --force')  // reinstall to fix corrupted deps
  await exec('pnpm dedupe')           // deduplicate versions
  await exec('pnpm update')           // bring everything up to date
  await exec('pnpm lint --fix || true') // try auto-fix if you use eslint

  log('✅ Maggie repair complete.')
})
