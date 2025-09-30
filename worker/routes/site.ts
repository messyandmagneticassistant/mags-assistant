import type { Env } from '../lib/env';
import { renderHomePage, renderPlaceholderPage } from '../lib/pages';

function asHead(response: Response): Response {
  return new Response(null, {
    status: response.status,
    headers: new Headers(response.headers),
  });
}

export async function handleSiteRequest(req: Request, _env: Env): Promise<Response | null> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;

  const url = new URL(req.url);
  const path = url.pathname === '' ? '/' : url.pathname;

  let response: Response | null = null;

  switch (path) {
    case '/':
      response = renderHomePage('/');
      break;
    case '/quiz':
      response = renderPlaceholderPage('/quiz', {
        title: 'Brand quiz',
        message: 'Our interactive brand quiz is getting its final sparkle. Join the waitlist below and we will tap you in when it is live.',
        actions: [
          { href: 'mailto:hey@messyandmagnetic.com?subject=Brand%20Quiz%20Waitlist', label: 'Join the waitlist', external: true },
          { href: '/', label: 'Return home' },
        ],
      });
      break;
    case '/shop':
      response = renderPlaceholderPage('/shop', {
        title: 'Messy & Magnetic shop',
        message: 'The shop is reopening soon with digital goods, workshops, and merch. Sign up to hear when the doors open.',
        actions: [
          { href: 'mailto:hey@messyandmagnetic.com?subject=Shop%20updates', label: 'Request updates', external: true },
          { href: '/donors', label: 'Support our donors' },
        ],
      });
      break;
    case '/about':
      response = renderPlaceholderPage('/about', {
        title: 'About Messy & Magnetic',
        message: 'We are documenting the full story. In the meantime you can follow along with our donor wall and daily experiments.',
        actions: [
          { href: '/donors', label: 'Meet the donors' },
          { href: '/', label: 'Back to home' },
        ],
      });
      break;
    default:
      return null;
  }

  if (!response) return null;
  return method === 'HEAD' ? asHead(response) : response;
}
