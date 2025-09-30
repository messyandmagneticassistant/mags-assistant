// worker/routes/cron.ts
export async function onScheduled(event: ScheduledEvent, env: any) {
  if (event.cron === '30 8 * * *') {
    // @ts-ignore - fundraising utilities live in shared application code
    const { runQueuedOutreach } = await import('../../src/' + 'fundraising/index');
    await runQueuedOutreach(env);
  }
  if (event.cron === '30 19 * * *') {
    // @ts-ignore - fundraising utilities live in shared application code
    const { sendDailyReport } = await import('../../src/' + 'fundraising/report');
    await sendDailyReport(env);
  }
}
