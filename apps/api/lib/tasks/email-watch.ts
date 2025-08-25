import { watchForEmail } from "../email";
import type { TaskResult } from "./index";

export async function emailWatch(): Promise<TaskResult> {
  try {
    const r = await watchForEmail();
    return { name: "email.watch", ok: r.ok !== false, msg: r.message };
  } catch (err: any) {
    return { name: "email.watch", ok: false, msg: err?.message || String(err) };
  }
}
