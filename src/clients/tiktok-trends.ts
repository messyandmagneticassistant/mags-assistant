export async function isTrendingCapCutRequired(username: string): Promise<boolean> {
  // Placeholder logic – in future, this could scrape TikTok, or pull from internal logs
  const recentTrendList = [
    'new capcut template', 'trend alert', 'use this sound', 'glow up effect',
  ];

  const recentCaption = await getLatestCaptionForUser(username);
  return recentTrendList.some(trend => recentCaption.toLowerCase().includes(trend));
}

// Mock for now
async function getLatestCaptionForUser(username: string): Promise<string> {
  return 'use this sound – new capcut template 💥'; // Replace with API/scraped result later
}