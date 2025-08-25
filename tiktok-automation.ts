import { runMaggie } from './maggie'
import { loadBrain } from './brain'
import { schedulePosts, boostPostViaAltProfiles } from './tiktok'
import { analyzeTrends, selectBestTime, evolveStrategy } from './insights'
import { getCompetitorBenchmarks } from './intel'

const main = async () => {
  await runMaggie()
    const config = await loadBrain('config:brain')

  const { topTrends, timingWindows } = await analyzeTrends(config)
  const bestTime = selectBestTime(timingWindows)

  const postPlan = await schedulePosts({
    trends: topTrends,
    timing: [bestTime],
    audienceNiche: config.audience,
    style: config.styleNaturalNotAI,
    rotation: config.emotionRotation
  })

  if (postPlan.nowReady && postPlan.nowIsOptimal) {
    await postPlan.postNow()
    await boostPostViaAltProfiles(postPlan.id)
  }

  await postPlan.scheduleRemaining()

  await evolveStrategy({
    analytics: await getCompetitorBenchmarks(config),
    audienceInsights: config.personalAudience,
    memoryLog: true
  })
}

main()
