/* eslint-disable no-console */
const must = (name: string, v?: string) => {
  const ok = !!(v && String(v).trim());
  console.log(`${ok ? '✅' : '❌'} ${name}: ${ok ? 'present' : 'MISSING'}`);
  return ok;
};

(async () => {
  console.log('--- TikTok / Browserless diag ---');

  const base = process.env.BROWSERLESS_BASE_URL || 'https://chrome.browserless.io';
  const key = process.env.BROWSERLESS_API_KEY;

  let ok = true;
  ok &&= must('BROWSERLESS_API_KEY', key);
  ok &&= must('BROWSERLESS_BASE_URL', base);
  ok &&= must('TIKTOK_SESSION_MAGGIE', process.env.TIKTOK_SESSION_MAGGIE);
  ok &&= must('TIKTOK_PROFILE_MAGGIE', process.env.TIKTOK_PROFILE_MAGGIE);

  if (key) {
    try {
      const r = await fetch(`${base}/sessions`, { headers: { 'x-api-key': key } });
      console.log(`🔌 Browserless: ${r.ok ? 'OK' : `HTTP ${r.status}`}`);
    } catch (e) {
      console.log('🔌 Browserless error:', String(e));
    }
  }

  console.log('Done. Fix any ❌ by updating .env (and Worker secrets if needed).');
})();