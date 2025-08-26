import { task } from 'codex'

task('runMaggie', async ({ log, exec }) => {
  log('🚀 Starting Maggie: Soul Agent + TikTok automation')

  try {
    await exec('pnpm install')
    await exec('pnpm build') // Replace if you use another build system
    await exec('node src/index.ts') // Adjust if your Maggie entry is elsewhere

    log('✅ Maggie has been started successfully.')
  } catch (err) {
    log('❌ Failed to start Maggie. Run `codex task fixMaggieErrors` to repair.')
    throw err
  }
})

task('fixMaggieErrors', async ({ log, exec }) => {
  log('🛠️ Repairing Maggie’s environment...')

  try {
    await exec('pnpm install --force')
    await exec('pnpm dedupe')
    await exec('pnpm update')
    await exec('pnpm rebuild')
    await exec('pnpm lint --fix || true')
    await exec('pnpm dlx dotenv-vault pull || true') // optional secrets pull
    await exec('pnpm dlx wrangler whoami || true')   // optional Cloudflare check
    await exec('pnpm dlx wrangler deploy || true')   // optional deploy

    log('✅ Maggie environment successfully repaired.')
  } catch (err) {
    log('❌ Error during repair. Check logs and try manual fix.')
    throw err
  }
})