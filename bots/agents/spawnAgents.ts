import { Agent } from '@/core/Agent'
import { loadConfigFromKV } from '@/utils/loadConfigFromKV'
import { threadStateKey } from '@/config/env'

export async function spawnAgent(agentName: string): Promise<Agent> {
  const config = await loadConfigFromKV(threadStateKey)
  const agentConfig = config?.agents?.[agentName]

  if (!agentConfig) {
    throw new Error(`Agent "${agentName}" not found in thread-state`)
  }

  const agent = new Agent(agentName, agentConfig)
  return agent
}