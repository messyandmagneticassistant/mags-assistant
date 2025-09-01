interface SA { client_email: string; private_key: string; }

function base64url(buffer: ArrayBuffer | string) {
  let bytes: Uint8Array;
  if (typeof buffer === 'string') {
    bytes = new TextEncoder().encode(buffer);
  } else {
    bytes = new Uint8Array(buffer);
  }
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getAccessToken(sa: SA, scopes: string[]): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const data = `${header}.${payload}`;
  const pkcs8 = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const jwt = `${data}.${base64url(sig)}`;
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const json = await res.json().catch(() => ({}));
  return json.access_token;
}

export async function createDoc(env: any, title: string, content: string): Promise<{ docId: string; pdfUrl: string }> {
  if (!env.GOOGLE_SERVICE_JSON) throw new Error('GOOGLE_SERVICE_JSON missing');
  const sa = JSON.parse(env.GOOGLE_SERVICE_JSON) as SA;
  const token = await getAccessToken(sa, [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
  ]);
  const docRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const doc = await docRes.json();
  const docId = doc.documentId;
  if (env.ORDERS_DRIVE_FOLDER_ID) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${docId}?addParents=${env.ORDERS_DRIVE_FOLDER_ID}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content,
          },
        },
      ],
    }),
  });
  const pdfUrl = `https://docs.google.com/document/d/${docId}/export?format=pdf`;
  return { docId, pdfUrl };
}
