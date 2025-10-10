export async function triggerReading(payload: {
  email: string;
  metadata: {
    tier: 'full' | 'lite' | 'mini';
    is_addon: boolean;
    child_friendly?: boolean;
  };
  sessionId: string;
  purchasedAt: string;
}) {
  // TODO: hook up Notion, Google Sheet, and soul reading PDF automation here
}
