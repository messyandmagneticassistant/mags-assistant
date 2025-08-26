export function getTodayMoodWord(): string {
  const moods = ['✨', '🌀', '🔥', '🌿', '💫', '🌙', '⚡', '🦋', '🍄', '🎭'];
  const dayIndex = new Date().getDay();
  return moods[dayIndex % moods.length];
}

export function getHashtagsFromTitle(title: string): string[] {
  const base = ['#fyp', '#viral', '#maggiebot'];
  const words = title.toLowerCase().split(/\s+/);
  const extras = [];

  if (words.includes('bunny')) extras.push('#rabbitsoftiktok');
  if (words.includes('rooster')) extras.push('#farmtok');
  if (words.includes('morning')) extras.push('#morningroutine');
  if (words.includes('kids')) extras.push('#momtok');

  return [...base, ...extras].slice(0, 5);
}