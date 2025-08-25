// Minimal task runner that stays under Vercel's function limits
import { syncHQ } from "./notion-sync";
import { refreshSocialPlanner } from "./social-planner";
import { sweepReminders } from "./reminders";
import { triageInbox } from "./inbox";
import { emailWatch } from "./email-watch";
import { socialPostDue } from "./social-post";
import { socialCollectInbox } from "./social-inbox";
import { socialRefreshAnalytics } from "./social-analytics";
import { stripeAudit } from "./stripe-audit";
import { outreachRun } from "./outreach";
import { socialGenerateDrafts } from "./social-drafts";
import { updateCoyoteSummary } from "./coyote-summary";

export type TaskResult = { name: string; ok: boolean; msg?: string };
export type TaskFn = () => Promise<TaskResult>;

export const tasks: Record<string, TaskFn> = {
  "notion.sync_hq": syncHQ,
  "social.refresh_planner": refreshSocialPlanner,
  "ops.sweep_reminders": sweepReminders,
  "ops.triage_inbox": triageInbox,
  "email.watch": emailWatch,
  "social.post_due": socialPostDue,
  "social.collect_inbox": socialCollectInbox,
  "social.refresh_analytics": socialRefreshAnalytics,
  "social.generate_drafts": socialGenerateDrafts,
  "stripe.audit": stripeAudit,
  "outreach.run": outreachRun,
  "coyote.summary": updateCoyoteSummary,
};

const taskFlags: Record<string, string> = {
  "notion.sync_hq": "TASK_NOTION_SYNC",
  "social.refresh_planner": "TASK_SOCIAL_REFRESH",
  "ops.sweep_reminders": "TASK_REMINDERS_SWEEP",
  "ops.triage_inbox": "TASK_INBOX_TRIAGE",
  "email.watch": "TASK_EMAIL_WATCH",
  "social.post_due": "TASK_SOCIAL_POST_DUE",
  "social.collect_inbox": "TASK_SOCIAL_INBOX",
  "social.refresh_analytics": "TASK_SOCIAL_ANALYTICS",
  "social.generate_drafts": "TASK_SOCIAL_GENERATE_DRAFTS",
  "stripe.audit": "TASK_STRIPE_AUDIT",
  "outreach.run": "TASK_OUTREACH_RUN",
  "coyote.summary": "TASK_COYOTE_SUMMARY",
};

export async function runTasks(selected?: string[]) {
  const names = selected?.length ? selected : Object.keys(tasks);
  const results: TaskResult[] = [];
  for (const name of names) {
    const flag = taskFlags[name];
    if (flag && process.env[flag] === "0") {
      results.push({ name, ok: true, msg: "skipped" });
      continue;
    }
    try {
      const res = await tasks[name]();
      results.push(res ?? { name, ok: true });
    } catch (err: any) {
      results.push({ name, ok: false, msg: err?.message || String(err) });
    }
  }
  return results;
}
