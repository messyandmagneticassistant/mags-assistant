export async function post({ caption, mediaUrl, linkUrl }: { caption?: string; mediaUrl?: string; linkUrl?: string }) {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log('[youtube] not configured');
    return 'not configured';
  }
  console.log('[youtube] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
