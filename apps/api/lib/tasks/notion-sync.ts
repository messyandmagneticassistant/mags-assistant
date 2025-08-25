import { notion, ensureRoot } from "../notion";

export async function syncHQ() {
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_ROOT_PAGE_ID) {
    return { name: "notion.sync_hq", ok: false, msg: "no_notion_env" };
  }
  const root = await ensureRoot();
  // Example: count subpages + cache a summary block
  const children = await notion.blocks.children.list({ block_id: root });
  // (no destructive writes; safe on every run)
  return { name: "notion.sync_hq", ok: true, msg: `subpages:${children.results.length}` };
}
