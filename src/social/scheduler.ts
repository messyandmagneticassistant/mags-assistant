export interface ScheduleReq {
  fileUrl: string;
  caption: string;
  whenISO: string;
}

export async function schedule(req: ScheduleReq) {
  // TODO: call worker endpoint /tiktok/schedule
  console.log('[scheduler] schedule', req.fileUrl, req.whenISO);
}

export async function reschedule(id: string, whenISO: string) {
  // TODO: call worker endpoint /tiktok/reschedule
  console.log('[scheduler] reschedule', id, whenISO);
}
