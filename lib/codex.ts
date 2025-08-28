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
  const model = process.env.CODEX_MODEL || 'gpt-4o'

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


// 🧠 NEW FUNCTION FOR TASK QUEUE EXECUTION

export async function runTaskQueue(task: any, config?: any) {
  const codexPrompt = getPromptForTask(task)
  console.log(`🧠 Running Codex Task: ${task.name}`)

  const result = await runWithCodex({
    task: codexPrompt,
    context: `You are Codex, an agent responsible for running autonomous tasks for Maggie, the assistant powering Messy & Magnetic.`
  })

  console.log(result)
  return result
}


// 🧩 PROMPT MAPPER

function getPromptForTask(task: any): string {
  switch (task.type) {
    case 'drive-cleanup':
      return `Clean up the user's Google Drive by removing duplicates, renaming unclear files, and organizing folders based on Maggie's soul blueprint and retreat systems. Do not delete anything unless it's clearly junk.`
    case 'notion-cleanup':
      return `Fix, organize, and format the user's Notion workspace. Make sure all soul blueprint pages, donor portals, and magnet bundle trackers are clear, functional, and aligned with the retreat system.`
    case 'stripe-sync':
      return `Sync all soul reading products, tiers, add-ons, and magnet bundles with Stripe. Ensure metadata is correct and prices match the latest blueprint.`
    case 'icon-bundle-generator':
      return `Auto-generate personalized icon bundles for each soul reading tier and quiz flow. Icons should match reading traits and rhythm types. Organize output into Google Drive.`
    case 'frontend-deploy':
      return `Finish and polish the frontend for the website, quiz funnel, Stripe products, and Notion donation buttons. Integrate everything and make it beautiful, matching the user's pastel, floral, farmhouse aesthetic.`
    case 'social-run':
      return `Start posting on TikTok via Maggie. Use trend research, pull from raw folders, post 10–30x/day using booster accounts, and aim for 1M followers in 30 days.`
    default:
      return `The task is: ${task.name}. Figure out what needs to be done and carry it out.`
  }
}