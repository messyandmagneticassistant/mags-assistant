export async function onRequestPost({ request, env }: any) {
  const body = await request.json().catch(() => ({}));
  const { name, email, tier = "intro", notes = "" } = body || {};
  if (!email) return new Response(JSON.stringify({ ok:false, error:"missing email" }), { status: 400 });

  // Call Apps Script
  const url = new URL(env.APPS_SCRIPT_WEBAPP_URL);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, tier, notes, secret: env.APPS_SCRIPT_SECRET || env.GEMINI_AGENT_SECRET })
  }).catch(() => null);

  const js = res ? await res.json().catch(() => ({})) : {};
  const pdfUrl = js.pdfUrl || js.pdf || "";

  // Email via Resend if configured, else just return the URL
  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && pdfUrl) {
    const from = `${env.RESEND_FROM_NAME || "Maggie"} <${env.RESEND_FROM_EMAIL}>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Your Soul Blueprint is ready ✨",
        html: `<p>Hi ${name || ""},</p><p>Your Soul Blueprint is ready.</p><p><a href="${pdfUrl}">Download your PDF</a></p><p>With heart, Maggie</p>`
      })
    }).catch(() => {});
  }

  // Log to Notion if configured
  if (env.NOTION_API_KEY && env.NOTION_DB_ID) {
    await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
      },
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DB_ID },
        properties: {
          Name: { title: [{ text: { content: name || email } }] },
          Email: { email },
          Tier: { select: { name: tier } },
          Status: { select: { name: "Delivered" } }
        }
      })
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, pdfUrl }), {
    status: 200, headers: { "content-type": "application/json" }
  });
}
