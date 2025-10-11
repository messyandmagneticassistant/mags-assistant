export interface TriggerReadingPayload {
  email: string;
  name: string;
  metadata: {
    tier: 'full' | 'lite' | 'mini';
    is_addon: boolean;
    child_friendly?: boolean;
    [key: string]: string | boolean | null | undefined;
  };
  sessionId: string;
  purchasedAt: string;
}

const DEFAULT_WEBHOOK_TIMEOUT_MS = 15_000;

export async function triggerReading(payload: TriggerReadingPayload) {
  const webhookUrl = process.env.MAKE_SOUL_READING_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error('MAKE_SOUL_READING_WEBHOOK_URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(
        `Soul reading webhook failed with status ${response.status}${
          responseText ? `: ${responseText}` : ''
        }`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Soul reading webhook timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
