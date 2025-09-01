export const onRequestGet = async ({ env }: any) => {
  const ok = { ok: true, time: new Date().toISOString() };
  return new Response(JSON.stringify(ok), { headers: { "content-type": "application/json" }});
};

export const diagConfig = async ({ env }: any) => {
  const keys = [
    "CLOUDFLARE_API_TOKEN","CF_ACCOUNT_ID","BROWSERLESS_API_KEY",
    "TIKTOK_SESSION_MAIN","TIKTOK_SESSION_WILLOW","TIKTOK_SESSION_MAGGIE","TIKTOK_SESSION_MARS",
    "TIKTOK_PROFILE_MAIN","TIKTOK_PROFILE_WILLOW","TIKTOK_PROFILE_MAGGIE","TIKTOK_PROFILE_MARS",
    "STRIPE_SECRET_KEY","TALLY_WEBHOOK_SECRET","NOTION_TOKEN","GOOGLE_SERVICE_JSON"
  ];
  const present = keys.reduce((o,k)=>{ o[k]= !!env[k]; return o; }, {} as Record<string, boolean>);
  return new Response(JSON.stringify({ present }), { headers: { "content-type": "application/json" }});
};
