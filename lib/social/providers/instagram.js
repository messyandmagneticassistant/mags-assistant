export async function post({ caption, mediaUrl, linkUrl }) {
  if (!process.env.INSTAGRAM_API_KEY) {
    console.log('[instagram] not configured');
    return 'not configured';
  }
  console.log('[instagram] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
