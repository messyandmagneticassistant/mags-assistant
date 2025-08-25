import { postDueClips } from "../social";
import type { TaskResult } from "./index";

export async function socialPostDue(): Promise<TaskResult> {
  try {
    const r = await postDueClips();
    return { name: "social.post_due", ok: r.ok !== false, msg: r.exportOnly ? "export" : undefined };
  } catch (err: any) {
    return { name: "social.post_due", ok: false, msg: err?.message || String(err) };
  }
}
