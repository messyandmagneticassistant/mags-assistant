export function getBrowserlessOptions() {
  return {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`,
  };
}