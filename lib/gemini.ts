import { GoogleAuth } from 'google-auth-library';

export async function geminiSuggestFix(context: string) {
  const key = process.env.GEMINI_API_KEY;
  const prompt = `You are a DevOps assistant. Given this context, suggest minimal, safe PR-ready changes. Respond with a short summary and bullet steps.\n\nCONTEXT:\n${context}`;
  if (key) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key="+key, {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const j = await r.json().catch(()=> ({}));
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return { ok:true, provider:"ai_studio", text };
  }
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION;
  if (project && location) {
    try {
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      const client = await auth.getClient();
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/gemini-1.5-flash:generateContent`;
      const res = await client.request({
        url,
        method: 'POST',
        data: { contents: [{ parts: [{ text: prompt }] }] },
      } as any);
      const text = (res.data as any)?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { ok: true, provider: 'gcp_vertex', text };
    } catch (e) {
      return { ok: false, reason: 'GCP_REQUEST_FAILED', error: String(e) };
    }
  }
  return { ok:false, reason:"NO_GEMINI_CREDENTIALS" };
}
