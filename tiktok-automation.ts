import { runMaggie } from './maggie'
import { loadBrain } from './brain'
import { runGrowthEngine } from './maggie/tiktok/growth-engine'
import { analyzeTrends, selectBestTime, evolveStrategy } from './insights'
import { getCompetitorBenchmarks } from './intel'

const main = async () => {
  await runMaggie()
    const config = await loadBrain('config:brain')

  const { topTrends, timingWindows } = await analyzeTrends(config)
  const bestTime = selectBestTime(timingWindows)

  await runGrowthEngine({ handle: config.tiktokHandle, timezone: config.timezone || 'America/Denver' })

  await evolveStrategy({
    analytics: await getCompetitorBenchmarks(config),
    audienceInsights: config.personalAudience,
    memoryLog: true,
    highlightWindow: bestTime
  })
}

main()
