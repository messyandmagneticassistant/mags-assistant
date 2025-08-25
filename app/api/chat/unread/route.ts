import { getUnreadCount, clearUnread } from '../../../../lib/unread';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const user = url.searchParams.get('user') || undefined;
  const clear = url.searchParams.get('clear');
  const count = await getUnreadCount(user);
  if (clear) {
    clearUnread(user);
  }
  return new Response(JSON.stringify({ count }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
