export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return {
    async streamChat(body: any) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('OpenAI request failed');
      return res;
    },
  };
}

export function buildSystemPrompt() {
  let prompt = 'You are Mags, the Messy and Magnetic assistant.';
  const parts: string[] = [];
  if (process.env.NOTION_TOKEN && process.env.NOTION_HQ_PAGE_ID && process.env.NOTION_QUEUE_DB) {
    parts.push(
      `You can access Notion. HQ page ${process.env.NOTION_HQ_PAGE_ID} and queue database ${process.env.NOTION_QUEUE_DB}.`
    );
  }
  if (process.env.STRIPE_SECRET_KEY) {
    parts.push('You can access Stripe APIs.');
  }
  if (parts.length) prompt += ' ' + parts.join(' ');
  return prompt;
}
