// worker/routes/cron.ts
import { runQueuedOutreach } from '../../src/fundraising/index';
import { sendDailyReport } from '../../src/fundraising/report';

export async function onScheduled(event: ScheduledEvent, env: any) {
  if (event.cron === '30 8 * * *') {
    await runQueuedOutreach(env);
  }
  if (event.cron === '30 19 * * *') {
    await sendDailyReport(env);
  }
}
