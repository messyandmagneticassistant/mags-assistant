const presets: Record<string, string> = {
  happy: 'Let the sunshine in ☀️',
  sad: "It's okay to feel it all 💧",
  validating: 'We see you. '
}

export function generateCaption(emotion = 'happy'): string {
  return presets[emotion] || `Feeling ${emotion}`
}
