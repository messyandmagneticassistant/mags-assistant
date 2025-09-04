const WORKER_BASE = 'https://maggie.messyandmagnetic.com';

export async function chat(message: string) {
  const res = await fetch(`${WORKER_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

export async function createBrowserSession() {
  const res = await fetch(`${WORKER_BASE}/api/browser/session`, {
    method: 'POST',
  });
  return res.json();
}
