export interface ScheduleReq { fileUrl: string; caption: string; hashtags?: string[]; whenISO: string; }

export async function schedule(req: ScheduleReq) {
  // TODO: call worker endpoint /tiktok/schedule
  const when = new Date(req.whenISO);
  console.log('[scheduler] schedule', req.fileUrl, when.toISOString());
}

export async function reschedule(id: string, whenISO: string) {
  // TODO: call worker endpoint /tiktok/reschedule
  const when = new Date(whenISO);
  console.log('[scheduler] reschedule', id, when.toISOString());
}
