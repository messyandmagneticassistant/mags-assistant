// lib/codex.ts
export async function runWithCodex({
  agentName = 'Codex',
  role = 'Code + Debug Assistant',
  context = `You are a powerful code agent named Codex. Your job is to help debug, automate, and optimize systems with full-stack precision.`,
  task
}: {
  agentName?: string
  role?: string
  context?: string
  task: string
}) {
  const key = process.env.OPENAI_API_KEY
  const model = process.env.CODEX_MODEL || 'gpt-4o' // Allows override in .env

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: task }
      ],
      temperature: 0.3
    })
  })

  const json = await response.json()
  return json.choices?.[0]?.message?.content ?? '[No output from Codex]'
}