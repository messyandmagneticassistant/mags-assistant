import { loadConfig, presence } from "./lib/config";

export const onRequestGet = async ({ env }: any) => {
  return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
    headers: { "content-type": "application/json" },
  });
};

/**
 * /diag/config — true/false presence check for the EXACT keys already in use.
 * Shows which KV keys are queried and whether the read succeeded.
 */
export const diagConfig = async ({ env }: any) => {
  const blobKey = env.SECRET_BLOB || "thread-state";
  const brainKey = env.BRAIN_DOC_KEY || "PostQ:thread-state";

  let kvReadOk = false;
  try {
    kvReadOk = !!(await env.BRAIN.get(blobKey));
  } catch {}

  const cfg = await loadConfig(env);

  const keys = [
    // === STRIPE ===
    "STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET",
    // === TALLY ===
    "TALLY_API_KEY","TALLY_SIGNING_SECRET","TALLY_WEBHOOK_FEEDBACK_ID","TALLY_WEBHOOK_QUIZ_ID",
    // === TELEGRAM ===
    "TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID",
    // === NOTION ===
    "NOTION_API_KEY","NOTION_DB_ID","NOTION_TOKEN","NOTION_DB_LOGS",
    // === TIKTOK SESSIONS ===
    "TIKTOK_SESSION_MAIN","TIKTOK_SESSION_WILLOW","TIKTOK_SESSION_MAGGIE","TIKTOK_SESSION_MARS",
    // === TIKTOK PROFILES ===
    "TIKTOK_PROFILE_MAIN","TIKTOK_PROFILE_WILLOW","TIKTOK_PROFILE_MAGGIE","TIKTOK_PROFILE_MARS",
    // === ALT EMAILS ===
    "ALT_TIKTOK_EMAIL_1","ALT_TIKTOK_EMAIL_2","ALT_TIKTOK_EMAIL_3",
    // === MAGGIE / INTERNAL ===
    "MAGS_ASSISTANT_TOKEN","POST_THREAD_SECRET","SECRET_BLOB",
    // === GOOGLE INTEGRATIONS ===
    "GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET","GOOGLE_MAPS_API_KEY","GOOGLE_GEOCODING_API_KEY",
    // === OPENAI / GEMINI ===
    "OPENAI_API_KEY","CODEX_AUTH_TOKEN",
    // === BROWSERLESS ===
    "BROWSERLESS_API_KEY","BROWSERLESS_BASE_URL",
    // === GITHUB ===
    "GITHUB_TOKEN","GITHUB_PAT",
    // === CLOUDFLARE ===
    "CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_ZONE_ID","CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_KV_POSTQ_NAMESPACE_ID","CLOUDFLARE_KV_POSTQ_HUMAN_NAME",
    // === VERCEL (optional) ===
    "VERCEL_API_TOKEN","VERCEL_PROJECT_ID","VERCEL_ORG_ID",
    // === WORKER URL ===
    "WORKER_URL",
    // === APPS SCRIPT ===
    "APPS_SCRIPT_WEBAPP_URL","APPS_SCRIPT_DEPLOYMENT_ID","APPS_SCRIPT_SCRIPT_ID","APPS_SCRIPT_EXEC",
    // === EXTRA FLAGS ===
    "USE_CAPCUT","CAPCUT_TEMPLATE","CAPCUT_EXPORT_FOLDER","CAPCUT_RAW_FOLDER","MAGGIE_LOG_TO_CONSOLE",
    // === BACKUPS / MISC ===
    "FETCH_PASS","PASS_WORD","WORKER_CRON_KEY","ADMIN_KEY"
  ];

  const present = presence(cfg, keys);

  return new Response(
    JSON.stringify({ present, blobKey, brainKey, kvReadOk }),
    { headers: { "content-type": "application/json" } }
  );
};
