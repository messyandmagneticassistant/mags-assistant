import { collectSocialInbox } from "../social";
import type { TaskResult } from "./index";

export async function socialCollectInbox(): Promise<TaskResult> {
  try {
    const r = await collectSocialInbox();
    return { name: "social.collect_inbox", ok: r.ok !== false };
  } catch (err: any) {
    return { name: "social.collect_inbox", ok: false, msg: err?.message || String(err) };
  }
}
