// src/fundraising/report.ts

export type DayStats = {
  sent: number;
  replies: number;
  submissions: number;
  next: string[];
};

export function buildReport(stats: DayStats) {
  const telegram = `Emails sent: ${stats.sent}\nReplies: ${stats.replies}\nSubmissions: ${stats.submissions}\nNext: ${stats.next.slice(0,3).join(', ')}`;
  const notion = {
    type: 'paragraph',
    content: telegram,
  };
  return { telegram, notion };
}

export async function sendDailyReport(_env: any): Promise<void> {
  // In real implementation this would gather data from Sheets and post to Telegram & Notion
  const sample = buildReport({ sent: 0, replies: 0, submissions: 0, next: [] });
  console.log('[fundraising] daily report', sample);
}
