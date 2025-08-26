import { getConfig } from '@/_utils/getConfig'
import chalk from 'chalk'

export async function verifyConfig() {
  const config = await getConfig()
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'TALLY_API_KEY',
    'TALLY_SIGNING_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'NOTION_API_KEY',
    'OPENAI_API_KEY',
    'TIKTOK_SESSION_MAIN',
    'TIKTOK_PROFILE_MAIN',
    'WORKER_URL'
  ]

  console.log(chalk.blue('🔍 Verifying loaded config from thread-state...'))
  let passed = 0

  for (const key of required) {
    if (config[key]) {
      console.log(chalk.green(`✅ ${key}`))
      passed++
    } else {
      console.log(chalk.red(`❌ Missing: ${key}`))
    }
  }

  console.log(chalk.yellow(`\nSummary: ${passed}/${required.length} passed\n`))

  if (passed !== required.length) {
    throw new Error('❌ Some required secrets are missing. Check your thread-state or .env!')
  }

  return config
}