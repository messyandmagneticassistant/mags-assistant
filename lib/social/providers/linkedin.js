export async function post({ caption, mediaUrl, linkUrl }) {
  if (!process.env.LINKEDIN_API_KEY) {
    console.log('[linkedin] not configured');
    return 'not configured';
  }
  console.log('[linkedin] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
