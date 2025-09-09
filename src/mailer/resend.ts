export interface ResendEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_FROM_NAME?: string;
}

export async function sendMail(
  env: ResendEnv,
  to: string,
  subject: string,
  text: string
): Promise<Response> {
  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.RESEND_FROM || env.RESEND_FROM_EMAIL || '';
  const fromName = env.RESEND_FROM_NAME || env.RESEND_FROM || '';
  if (!apiKey || !fromEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'missing resend config' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text
    })
  });
  return resp;
}
