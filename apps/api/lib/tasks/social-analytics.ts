import { refreshAnalytics } from "../social";
import type { TaskResult } from "./index";

export async function socialRefreshAnalytics(): Promise<TaskResult> {
  try {
    const r = await refreshAnalytics();
    return { name: "social.refresh_analytics", ok: r.ok !== false };
  } catch (err: any) {
    return { name: "social.refresh_analytics", ok: false, msg: err?.message || String(err) };
  }
}
