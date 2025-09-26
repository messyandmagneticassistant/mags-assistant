type GeminiJSONOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

interface GeminiCandidate {
  content?: {
    parts?: Array<{
      text?: string;
      functionCall?: { arguments?: string };
    }>;
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

const DEFAULT_MODEL = 'gemini-1.5-pro';

function getModel(options?: GeminiJSONOptions): string {
  return options?.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

export async function callGeminiJSON<T>(
  prompt: string,
  options?: GeminiJSONOptions,
): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const model = getModel(options);
  const baseUrl = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';
  const url = `${baseUrl}/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        maxOutputTokens: options?.maxOutputTokens ?? 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${JSON.stringify(json)}`);
  }

  const candidate = json.candidates?.[0];
  const rawText = extractCandidateText(candidate);
  if (!rawText) {
    throw new Error('Gemini returned empty response');
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (error) {
    throw new Error(`Failed to parse Gemini JSON: ${(error as Error).message}\n${rawText}`);
  }
}

function extractCandidateText(candidate?: GeminiCandidate): string | null {
  if (!candidate?.content?.parts?.length) return null;
  const textParts: string[] = [];

  for (const part of candidate.content.parts) {
    if (part.text) {
      textParts.push(part.text);
      continue;
    }
    const fnArgs = part.functionCall?.arguments;
    if (fnArgs) {
      textParts.push(fnArgs);
    }
  }

  if (textParts.length === 0) return null;

  const combined = textParts.join('\n').trim();
  if (!combined) return null;

  if (combined.startsWith('```')) {
    const withoutFence = combined.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    return withoutFence;
  }

  return combined;
}

export default callGeminiJSON;
