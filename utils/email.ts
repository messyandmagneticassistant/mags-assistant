
export interface EmailPayload {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailResult {
  id?: string;
}

export interface EmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_FROM_NAME?: string;
  [key: string]: any;
}

function resolveConfig(env?: EmailEnv) {
  const apiKey = env?.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
  const fromEmail = env?.RESEND_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? "maggie@messyandmagnetic.com";
  const fromName = env?.RESEND_FROM_NAME ?? process.env.RESEND_FROM_NAME ?? "Maggie";
  return { apiKey, fromEmail, fromName };
}

export async function sendEmail(payload: EmailPayload, env?: EmailEnv): Promise<EmailResult> {
  const { apiKey, fromEmail, fromName } = resolveConfig(env);
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  if (!fromEmail) throw new Error("Missing RESEND_FROM_EMAIL");

  const body = {
    from: `${fromName} <${fromEmail}>`,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  } as RequestInit);

  const data = (await res.json().catch(() => ({}))) as EmailResult & { error?: any };
  const id = (data as any).id;
  console.log(`[email] to=${Array.isArray(payload.to) ? payload.to.join(",") : payload.to}, subject=${payload.subject}, provider=resend, id=${id ?? ""}`);
  if (!res.ok) {
    throw new Error(data?.error?.message || `Resend error: ${res.status}`);
  }
  return { id };
}

export function getEmailConfig(env?: EmailEnv) {
  return resolveConfig(env);
}

