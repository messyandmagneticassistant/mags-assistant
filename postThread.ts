import type { PostThreadParams } from './src/types';

export async function postThread({ bot, message }: PostThreadParams) {
  try {
    const body = {
      username: bot.username,
      message,
    };

    const response = await fetch('https://assistant.messyandmagnetic.com/thread-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.POST_THREAD_SECRET || ''}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`[postThread] HTTP ${response.status} - ${await response.text()}`);
    }

    console.info('[postThread] Message posted successfully.');
  } catch (err) {
    console.error('[postThread] Failed to post message:', err);
  }
}