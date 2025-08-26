// shared/logger.ts

export function log(message: string, ...args: any[]) {
  const now = new Date();
  const time = now.toISOString().split('T')[1].replace('Z', '');
  console.log(`[Maggie | ${time}] ${message}`, ...args);
}