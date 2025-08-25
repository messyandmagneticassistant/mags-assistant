import { generateDraftsFromDrive } from "../social";
import type { TaskResult } from "./index";

export async function socialGenerateDrafts(): Promise<TaskResult> {
  try {
    const r = await generateDraftsFromDrive();
    return { name: "social.generate_drafts", ok: r.ok !== false, msg: r.items ? `${r.items}_items` : r.msg };
  } catch (err: any) {
    return { name: "social.generate_drafts", ok: false, msg: err?.message || String(err) };
  }
}
