export type CodexPrompt = {
  system: string;
  input: string;
  examples?: { input: string; output: string }[];
  temperature?: number;
};

export async function runCodex(prompt: CodexPrompt): Promise<{ text: string }> {
  const temperature = prompt.temperature ?? 0.7;

  // 🧠 Build the full prompt string
  let fullPrompt = prompt.system + '\n\n';

  if (prompt.examples) {
    for (const ex of prompt.examples) {
      fullPrompt += `Input: ${ex.input}\nOutput: ${ex.output}\n\n`;
    }
  }

  fullPrompt += `Input: ${prompt.input}\nOutput:`;

  // 📡 Send to AI (can be OpenAI, Gemini, Claude, etc.)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: prompt.system },
        ...(prompt.examples?.map(ex => [
          { role: 'user', content: `Input: ${ex.input}` },
          { role: 'assistant', content: `Output: ${ex.output}` },
        ]) || []).flat(),
        { role: 'user', content: `Input: ${prompt.input}` },
      ],
      temperature,
    }),
  });

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content?.trim();

  return { text: content ?? '[codex] failed to return output' };
}
