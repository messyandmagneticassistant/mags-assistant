export async function post({ caption, mediaUrl, linkUrl }) {
  if (!process.env.TWITTER_API_KEY) {
    console.log('[twitter] not configured');
    return 'not configured';
  }
  console.log('[twitter] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
