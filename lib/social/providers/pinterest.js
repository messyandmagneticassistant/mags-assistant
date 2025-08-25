export async function post({ caption, mediaUrl, linkUrl }) {
  if (!process.env.PINTEREST_API_KEY) {
    console.log('[pinterest] not configured');
    return 'not configured';
  }
  console.log('[pinterest] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
