const base = process.env.TEST_BASE || 'http://localhost:8787';
const headers = { 'content-type': 'application/json' };

async function hit(path: string, init?: RequestInit) {
  try {
    const res = await fetch(base + path, init);
    console.log(path, res.status);
    return await res.text();
  } catch (err) {
    console.error(path, 'failed', err);
  }
}

(async () => {
  await hit('/health');
  await hit('/admin/social-mode');
  await hit('/planner/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({ dryrun: true }),
  });
  const whenISO = new Date(Date.now() + 60 * 1000).toISOString();
  await hit('/tiktok/schedule', {
    method: 'POST',
    headers,
    body: JSON.stringify({ whenISO }),
  });
})();
