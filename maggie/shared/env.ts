export function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env: ${key}`)
  return val
}
