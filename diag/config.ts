// Smoke test to verify brain config includes TikTok profiles
/* eslint-disable no-console */
(async () => {
  try {
    const res = await fetch('https://maggie.messyandmagnetic.com/config?scope=brain');
    const brain = await res.json();
    const handle = brain?.tiktok?.profiles?.main?.handle;
    if (handle === '@messyandmagnetic') {
      console.log('✅ brain.tiktok.profiles.main.handle ok');
    } else {
      console.error('❌ brain.tiktok.profiles.main.handle mismatch:', handle);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ failed to fetch brain config:', err);
    process.exit(1);
  }
})();
