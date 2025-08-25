import { readSoulBlueprint } from './soul-utils'
import { suggestMagnetIcons } from './magnet-utils'

export async function matchMagnetsFromSoul(userId: string) {
  const soul = await readSoulBlueprint(userId)
  const keywords = [soul.sunSign, ...soul.gifts, ...soul.themes]
  return suggestMagnetIcons(keywords)
}
