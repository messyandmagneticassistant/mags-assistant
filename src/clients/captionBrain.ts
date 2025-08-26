import path from 'path';
import { BotSession } from '../../types';
import { getTodayMoodWord, getHashtagsFromTitle } from './captionUtils';

export async function generateCaption(bot: BotSession): Promise<string> {
  const filename = bot.lastVideoPath
    ? path.basename(bot.lastVideoPath).replace(/\.(mp4|mov)$/, '')
    : 'Untitled';

  const titleGuess = filename.replace(/[_-]/g, ' ').trim();
  const mood = getTodayMoodWord();
  const hashtags = getHashtagsFromTitle(titleGuess);

  const caption = `${mood} • ${titleGuess}\n\n${hashtags.join(' ')}`;

  return caption.slice(0, 2200); // TikTok caption limit
}