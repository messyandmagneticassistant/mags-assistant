let store: Record<string, number> = {};

export async function getUnreadCount(userId?: string): Promise<number> {
  return store[userId || 'default'] || 0;
}

export function setUnreadCount(count: number, userId?: string) {
  store[userId || 'default'] = count;
}

export function clearUnread(userId?: string) {
  delete store[userId || 'default'];
}
