export async function triggerReading(payload: {
  email: string;
  name: string;
  metadata: {
    tier: 'full' | 'lite' | 'mini';
    is_addon: boolean;
    child_friendly?: boolean;
  };
  sessionId: string;
  purchasedAt: string;
}) {
  // TODO: Implement Notion + Google Sheet + reading generator logic here
}
