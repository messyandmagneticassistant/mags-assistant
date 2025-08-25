export const COOKIE_NAME = 'mags-chat';

export function passwordEnabled() {
  return !!process.env.CHAT_PASSWORD;
}

export function verifyPassword(input: string) {
  const pass = process.env.CHAT_PASSWORD;
  if (!pass) return true;
  return input === pass;
}

export function sessionCookie(password: string) {
  return `${COOKIE_NAME}=${password}; Path=/; Max-Age=86400`;
}

export function checkAuth(req: Request) {
  const pass = process.env.CHAT_PASSWORD;
  if (!pass) return true;
  const cookie = req.headers.get('cookie') || '';
  return cookie.split(';').some((c) => c.trim() === `${COOKIE_NAME}=${pass}`);
}
