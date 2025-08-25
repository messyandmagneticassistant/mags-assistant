import { postMessage } from './src/clients/postq';

export async function postThread({
  bot,
  message,
}: {
  bot: { username: string; session: string };
  message: string;
}) {
  try {
    await postMessage({
      session: bot.session,
      username: bot.username,
      threadId: process.env.POSTQ_THREAD_ID!,
      message,
    });
  } catch (err) {
    console.error('[postThread] failed to post message:', err);
  }
}