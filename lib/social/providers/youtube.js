export async function post({ caption, mediaUrl, linkUrl }) {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log('[youtube] not configured');
    return 'not configured';
  }
  console.log('[youtube] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
