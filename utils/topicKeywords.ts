// utils/topicKeywords.ts

export function getTopicKeywords(title: string): string[] {
  if (!title || typeof title !== 'string') return [];

  const raw = title.toLowerCase();

  const stopwords = [
    'the', 'this', 'that', 'and', 'with', 'for',
    'from', 'what', 'when', 'how', 'why', 'is',
    'a', 'in', 'on'
  ];

  const tokens = raw
    .replace(/[^a-zA-Z0-9\s]/g, '') // remove punctuation
    .split(/\s+/)                   // split by space
    .filter(word => word.length > 2 && !stopwords.includes(word));

  const freq: Record<string, number> = {};

  for (const word of tokens) {
    freq[word] = (freq[word] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])   // sort by frequency descending
    .map(([word]) => word)
    .slice(0, 5);                  // return top 5
}