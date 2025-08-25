import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function ensureRoot() {
  const id = process.env.NOTION_ROOT_PAGE_ID;
  if (!id) throw new Error("missing NOTION_ROOT_PAGE_ID");
  return id;
}
