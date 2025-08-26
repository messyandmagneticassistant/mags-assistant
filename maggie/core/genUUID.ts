export function genUUID(): string {
  return crypto.randomUUID(); // Node 16+ OR polyfill if needed
}