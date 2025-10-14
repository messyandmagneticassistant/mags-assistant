import puppeteer from 'puppeteer-core';

const BROWSERLESS_API_KEY = process.env.BROWSERLESS_API_KEY!;
const sessionCookie = process.env.TIKTOK_SESSION_MAIN!;
const profileUrl = 'https://www.tiktok.com/@messyandmagnetic';

const run = async () => {
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_API_KEY}`
  });
  const page = await browser.newPage();
  await page.setCookie({
    name: 'sessionid',
    value: sessionCookie,
    domain: '.tiktok.com',
    path: '/',
    httpOnly: true,
    secure: true
  });

  await page.goto(profileUrl, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'tiktok-profile.png' });
  console.log('✅ TikTok page loaded and screenshot saved.');

  await browser.close();
};

run().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
