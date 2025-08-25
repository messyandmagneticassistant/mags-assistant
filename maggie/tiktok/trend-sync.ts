import axios from 'axios'

export async function fetchTrendingAudios(): Promise<string[]> {
  const { data } = await axios.get('https://trends.tiktok.com/sounds') // swap to CapCut fallback if down
  const matches = data.match(/music\/[\w-]+\?/g) || []
  return matches.map(m => `https://www.tiktok.com/${m.split('?')[0]}`).slice(0, 10)
}
