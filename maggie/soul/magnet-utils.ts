const iconMap: Record<string, string> = {
  aries: '♈',
  courage: '🦁',
  leadership: '⭐'
}

export function suggestMagnetIcons(keywords: string[]) {
  return keywords.map(k => iconMap[k.toLowerCase()] || '❓')
}
