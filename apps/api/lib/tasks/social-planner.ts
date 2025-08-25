import {
  buildSchedule,
  logScheduleToSheet,
  buildGmailFilters,
} from '../../../../lib/social/tiktokScheduler.js';

export async function refreshSocialPlanner() {
  const schedule = await buildSchedule();
  await logScheduleToSheet(schedule);
  const filters = await buildGmailFilters();
  return {
    name: 'social.refresh_planner',
    ok: true,
    scheduled: schedule.length,
    filters,
  };
}
