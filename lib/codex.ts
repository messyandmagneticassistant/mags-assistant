// lib/codex.ts

/**
 * 🧠 Codex Agent + Task Runner
 * ----------------------------
 * Allows autonomous execution of backend tasks using OpenAI’s API.
 * Fully integrates with Maggie and Codex agents for running operations
 * across Google Drive, Notion, Stripe, and frontend systems.
 */

type CodexRunOptions = {
  agentName?: string
  role?: string
  context?: string
  task: string
  model?: string
}

export async function runWithCodex({
  agentName = 'Codex',
  role = 'Code + Debug Assistant',
  context = `You are a powerful code agent named Codex. Your job is to help debug, automate, and optimize systems with full-stack precision.`,
  task,
  model = process.env.CODEX_MODEL || 'gpt-4o'
}: CodexRunOptions): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY in environment variables.')

  const messages = [
    { role: 'system', content: `[${agentName}] — ${role}. Context:\n${context}` },
    { role: 'user', content: task }
  ]

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3
      })
    })

    const json = await response.json()
    if (!response.ok || !json?.choices?.[0]?.message?.content) {
      console.error('[Codex Error]', json)
      return '[Codex Error: No output or failed request]'
    }

    return json.choices[0].message.content
  } catch (err) {
    console.error('[Codex Exception]', err)
    return `[Codex Exception: ${err}]`
  }
}

/**
 * 🔁 Task Queue Executor
 * ----------------------
 * Trigger a Codex task using a system-level prompt and log the result.
 */

export async function runTaskQueue(task: any, config?: any) {
  const codexPrompt = getPromptForTask(task)

  console.log(`🧠 Running Codex Task: ${task.name}`)

  const result = await runWithCodex({
    task: codexPrompt,
    agentName: 'Codex',
    role: 'Autonomous Operations Agent',
    context: `You are Codex, an autonomous AI agent working for Chanel to manage and complete technical, creative, and operational tasks across Maggie's infrastructure.`
  })

  console.log(`✅ Codex completed: ${task.name}\n`, result)
  return result
}

/**
 * 🧩 Prompt Mapper
 * ----------------
 * Maps incoming task types to fully-contextual prompts for Codex.
 */

function getPromptForTask(task: any): string {
  switch (task.type) {
    case 'drive-cleanup':
      return `Clean up the user's Google Drive by removing duplicates, renaming unclear files, and organizing folders based on Maggie's soul blueprint and retreat systems. Delete only obvious junk.`
    case 'notion-cleanup':
      return `Audit and organize the user's Notion workspace. Ensure all pages related to soul readings, retreat donations, magnet bundles, and quiz flows are clear, styled, and integrated.`
    case 'stripe-sync':
      return `Sync all products and pricing from the soul blueprint tiers and magnet bundles into Stripe. Verify metadata, optional add-ons, and tier logic are accurate and live.`
    case 'icon-bundle-generator':
      return `Generate custom icon bundles for each soul blueprint reading (Mini, Lite, Full) based on their traits. Icons must match the magnet system categories and be saved into Google Drive folders per person.`
    case 'frontend-deploy':
      return `Build and polish the frontend for the website, quiz, product listings, and donation portal. Match pastel/cottagecore branding and ensure all functionality is connected.`
    case 'social-run':
      return `Start Maggie's TikTok automation. Pull videos from raw folders, edit with trending audio, post 10–30x/day using booster accounts, aim for 1M followers in 30 days, and log performance.`
    case 'product-fix':
      return `Verify all current product listings across Stripe, Etsy, and Notion. Ensure prices, add-ons, and fulfillment logic match the latest soul system tier structure. Fix mismatches or missing items.`
    case 'blueprint-formatter':
      return `Format all Soul Blueprint readings (Mini, Lite, Full) into beautiful branded PDFs and Google Docs. Match pastel spiritual aesthetics and ensure correct chart interpretation per tier.`
    case 'task-meta-update':
      return `Update all current task definitions in the queue. Refactor task naming, grouping, and status fields to follow clean conventions. Include field for priority and execution logs.`
    default:
      return `A task titled "${task.name}" needs to be executed. Review and determine what actions are required. Execute it autonomously.`
  }
}