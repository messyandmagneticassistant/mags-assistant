// maggie/core/generateCaption.ts

import { log } from '../shared/logger';
import { getTopicKeywords } from '../utils/topicKeywords';
import { getTimestampTag } from '../utils/timestampTag';
import { shuffleArray } from '../utils/shuffle';

type GenerateInput = {
  title: string;
};

export async function generateCaptionAndOverlay({
  title,
}: GenerateInput): Promise<{
  caption: string;
  overlay: string;
  hashtags: string[];
  firstComment?: string;
}> {
  const keywords = getTopicKeywords(title);
  const timeTag = getTimestampTag();
  const hashtags = generateHashtags(keywords, timeTag);
  const overlay = generateOverlayText(keywords);

  const caption = [
    `${title.trim()} ${timeTag}`,
    '',
    hashtags.map(h => `#${h}`).join(' '),
  ].join('\n');

  const firstComment = keywords.length > 3
    ? `More on this soon... 👀 #${keywords[0]}`
    : undefined;

  log('[generateCaptionAndOverlay] generated caption + overlay');
  return {
    caption,
    overlay,
    hashtags,
    firstComment,
  };
}

function generateHashtags(keywords: string[], timeTag: string): string[] {
  const common = ['fyp', 'viral', 'trending', 'messyandmagnetic'];
  const combined = [...keywords, ...common, timeTag.replace(/\s/g, '')];
  return shuffleArray(combined).slice(0, 5);
}

function generateOverlayText(keywords: string[]): string {
  if (!keywords.length) return 'watch this.';
  const hook = keywords[0];
  return `when ${hook.toLowerCase()} hits different`;
}