import puppeteer from 'puppeteer'
import { getEnv } from '../shared/env'

export async function schedulePost(videoPath: string, caption: string) {
  const browser = await puppeteer.connect({ browserWSEndpoint: getEnv('BROWSERLESS_URL') })
  const page = await browser.newPage()
  await page.goto('https://www.tiktok.com/upload')
  // TODO: implement upload logic
  await browser.close()
}
