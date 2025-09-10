export async function tgSend(text: string, _chat?: string) {
  console.log('[tgSend]', text);
  return { ok: true };
}
