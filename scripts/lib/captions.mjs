export function makeCaption({ title = '', themes = [], cta = '', tone = '' } = {}) {
  const headline = title.trim();
  const tagString = Array.isArray(themes)
    ? themes.map(t => `#${t.replace(/\s+/g, '')}`).join(' ')
    : '';
  const parts = [headline, cta.trim(), tagString].filter(Boolean);
  return parts.join('\n\n');
}
