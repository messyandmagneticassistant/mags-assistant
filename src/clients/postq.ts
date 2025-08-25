import { post } from 'axios';

export async function postMessage({
  session,
  username,
  threadId,
  message,
}: {
  session: string;
  username: string;
  threadId: string;
  message: string;
}) {
  if (!threadId || !message) return;

  try {
    await post('https://postq.messyandmagnetic.com/api/post', {
      session,
      username,
      threadId,
      message,
    });
  } catch (err) {
    console.error('[postMessage] failed to send:', err);
  }
}