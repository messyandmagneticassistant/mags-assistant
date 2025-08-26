// bots/agents/agentbrain.ts

import { agentConfigs, AgentConfig } from './agentconfigs';
import { postThread } from '../../postThread';
import { fetchTrends } from '../utils/trendScanner'; // optional trend tool
import { callGeminiOrGPT } from '../utils/llmBridge'; // auto-switch AI
import { getNotionMemory } from '../utils/notionBridge';
import { getGoogleSheetValues } from '../utils/sheetBridge';

type AgentActionInput = {
  botName: string;
  context: 'caption' | 'comment' | 'overlay' | 'hashtag' | 'reply';
  inputText?: string;
  videoMeta?: Record<string, any>;
  threadId?: string;
  mood?: string;
};

export async function agentAct({
  botName,
  context,
  inputText,
  videoMeta,
  threadId,
  mood,
}: AgentActionInput): Promise<string> {
  const config: AgentConfig = agentConfigs[botName];
  if (!config) throw new Error(`Unknown agent: ${botName}`);

  let memory: string[] = [];

  // Gather learning sources
  for (const source of config.autoLearnFrom || []) {
    if (source.includes('Notion')) {
      const notes = await getNotionMemory(source);
      memory.push(...notes);
    } else if (source.includes('Sheet')) {
      const sheetRows = await getGoogleSheetValues(source);
      memory.push(...sheetRows);
    }
  }

  // Optional: add trend content
  const trends = await fetchTrends({
    tags: config.researchTags,
    type: context,
  });

  const prompt = `
You are ${config.name}, a TikTok agent with this tone: "${config.tone}". 
You're acting in a ${context} context. Style: ${config.captionStyle}, reply style: ${config.replyStyle}.
Video meta: ${JSON.stringify(videoMeta || {})}
Prior memory: ${memory.slice(0, 5).join('\n')}
Trending examples: ${trends.slice(0, 3).join('\n')}

Instructions:
${config.overrideInstructions}

Use this user input if relevant: "${inputText || ''}"

Now return the most accurate response, in your style only.
`;

  const aiResponse = await callGeminiOrGPT(prompt);

  if (threadId) {
    await postThread({
      bot: { name: botName },
      message: `🧠 Agent "${botName}" responded in context "${context}":\n\n${aiResponse}`,
    });
  }

  return aiResponse;
}