// utils/timestampTag.ts

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function getTimestampTag(prefix = 'Post'): string {
  const now = new Date();
  const day = now.getDate();
  const month = monthNames[now.getMonth()];
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = now.getMinutes().toString().padStart(2, '0');

  return `${prefix} ${month} ${day} @ ${hour}:${minute}`;
}