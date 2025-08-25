import { runOutreach } from "../outreach";
import type { TaskResult } from "./index";

export async function outreachRun(): Promise<TaskResult> {
  try {
    const r = await runOutreach();
    return { name: "outreach.run", ok: r.ok !== false };
  } catch (err: any) {
    return { name: "outreach.run", ok: false, msg: err?.message || String(err) };
  }
}
