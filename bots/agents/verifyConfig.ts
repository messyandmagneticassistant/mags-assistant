import { loadConfigFromKV } from '@/utils/loadConfigFromKV'
import { threadStateKey } from '@/config/env'

export async function verifyConfig() {
  const config = await loadConfigFromKV(threadStateKey)

  if (!config) {
    console.error('❌ Failed to load config from thread-state.')
    return
  }

  if (!config.agents?.maggie) {
    console.warn('⚠️ Maggie not found in agents list.')
  } else {
    console.log('✅ Maggie config loaded from thread-state:')
    console.dir(config.agents.maggie, { depth: null })
  }
}
