export async function post({ caption, mediaUrl, linkUrl, scheduleTime }) {
  if (process.env.OFFLINE_MODE === 'true') {
    console.log('[tiktok] offline mode — skipping external calls');
    return 'offline';
  }
  if (process.env.SCHEDULER === 'tiktok_api') {
    if (!process.env.TIKTOK_ACCESS_TOKEN) {
      console.log('[tiktok] TikTok token missing');
      return 'token_missing';
    }
    console.log('[tiktok] schedule via API', {
      caption,
      mediaUrl,
      scheduleTime,
    });
    return 'scheduled';
  }
  if (!process.env.TIKTOK_ACCESS_TOKEN) {
    console.log('[tiktok] not configured');
    return 'not_configured';
  }
  console.log('[tiktok] post', { caption, mediaUrl, linkUrl });
  return 'ok';
}
