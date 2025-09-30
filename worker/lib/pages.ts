export type NavLink = { href: string; label: string };

export const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/donors', label: 'Donors' },
  { href: '/quiz', label: 'Quiz' },
  { href: '/shop', label: 'Shop' },
  { href: '/about', label: 'About' },
];

export type PageRenderOptions = {
  title: string;
  description?: string;
  body: string;
  currentPath: string;
  status?: number;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildNav(currentPath: string): string {
  return NAV_LINKS.map((link) => {
    const isActive = link.href === currentPath || (link.href !== '/' && currentPath.startsWith(`${link.href}/`));
    const attrs = isActive ? ' class="nav-link active" aria-current="page"' : ' class="nav-link"';
    return `<a href="${link.href}"${attrs}>${link.label}</a>`;
  }).join('');
}

const BASE_STYLES = `
  :root {
    color-scheme: light dark;
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background-color: #0f172a;
    color: #f8fafc;
  }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(160deg, rgba(15, 23, 42, 0.95), rgba(30, 64, 175, 0.85));
  }
  header {
    padding: 1.5rem 1rem 1rem;
  }
  .header-inner {
    max-width: 960px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  nav {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .brand {
    font-size: 1.5rem;
    font-weight: 600;
  }
  .brand span {
    color: #fbbf24;
  }
  .nav-link {
    color: #f8fafc;
    text-decoration: none;
    font-weight: 500;
    opacity: 0.9;
    transition: opacity 0.2s ease;
  }
  .nav-link:hover,
  .nav-link:focus {
    opacity: 1;
    text-decoration: underline;
  }
  .nav-link.active {
    opacity: 1;
    border-bottom: 2px solid #fbbf24;
    padding-bottom: 0.25rem;
  }
  main {
    flex: 1;
    padding: 0 1rem 3rem;
  }
  .content {
    max-width: 960px;
    margin: 0 auto;
  }
  .hero {
    margin-top: 2rem;
    padding: 2.5rem;
    border-radius: 1.5rem;
    background: rgba(15, 23, 42, 0.7);
    box-shadow: 0 20px 45px rgba(15, 23, 42, 0.35);
  }
  .hero h1 {
    margin: 0 0 1rem;
    font-size: clamp(2rem, 3vw + 1rem, 3rem);
  }
  .hero p {
    font-size: 1.1rem;
    line-height: 1.6;
    margin: 0;
    max-width: 40ch;
  }
  .section {
    margin-top: 3rem;
    background: rgba(15, 23, 42, 0.6);
    border-radius: 1rem;
    padding: 2rem;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.3);
  }
  .section h2 {
    margin-top: 0;
    font-size: 1.75rem;
  }
  .muted {
    color: rgba(248, 250, 252, 0.75);
    font-size: 0.95rem;
    line-height: 1.6;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(59, 130, 246, 0.2);
    color: #bfdbfe;
    padding: 0.5rem 1rem;
    border-radius: 999px;
    font-size: 0.9rem;
    margin-top: 1rem;
  }
  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 2rem;
  }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.85rem 1.6rem;
    border-radius: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    background: linear-gradient(120deg, #fbbf24, #fb7185);
    color: #0f172a;
    box-shadow: 0 12px 25px rgba(248, 113, 113, 0.35);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .button.secondary {
    background: rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    box-shadow: none;
  }
  .button:hover,
  .button:focus {
    transform: translateY(-2px);
    box-shadow: 0 18px 32px rgba(248, 113, 113, 0.45);
  }
  footer {
    padding: 2rem 1rem 3rem;
    text-align: center;
    color: rgba(148, 163, 184, 0.85);
    font-size: 0.85rem;
  }
  ul.donor-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  ul.donor-list li {
    background: rgba(15, 23, 42, 0.55);
    border-radius: 0.85rem;
    padding: 1.25rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .donor-name {
    font-size: 1.1rem;
    font-weight: 600;
  }
  .donor-meta {
    margin-top: 0.25rem;
    color: rgba(148, 163, 184, 0.95);
    font-size: 0.9rem;
  }
  .donor-message {
    margin-top: 0.75rem;
    font-size: 1rem;
    line-height: 1.5;
  }
  .empty-state {
    text-align: center;
    padding: 2rem;
    background: rgba(15, 23, 42, 0.5);
    border-radius: 1rem;
    border: 1px dashed rgba(148, 163, 184, 0.35);
  }
  .error {
    border-left: 3px solid #f87171;
    padding-left: 1rem;
    color: #fecaca;
    margin-top: 1rem;
  }
  @media (max-width: 640px) {
    header {
      padding: 1.25rem 1rem 0.75rem;
    }
    .hero {
      padding: 2rem 1.5rem;
    }
    .section {
      padding: 1.5rem;
    }
    nav {
      gap: 0.75rem;
    }
    .button-row {
      flex-direction: column;
      align-items: stretch;
    }
    .button {
      width: 100%;
      text-align: center;
    }
  }
`;

export function renderPage(options: PageRenderOptions): Response {
  const { title, description, body, currentPath, status = 200 } = options;
  const nav = buildNav(currentPath);
  const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)} · Messy &amp; Magnetic</title>
      ${description ? `<meta name="description" content="${escapeHtml(description)}" />` : ''}
      <style>${BASE_STYLES}</style>
    </head>
    <body>
      <header>
        <div class="header-inner">
          <div class="brand">Messy <span>&amp;</span> Magnetic</div>
          <nav>${nav}</nav>
        </div>
      </header>
      <main>
        <div class="content">
          ${body}
        </div>
      </main>
      <footer>
        © ${new Date().getFullYear()} Messy &amp; Magnetic · Crafted with community magic
      </footer>
    </body>
  </html>`;

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export type PlaceholderCopy = {
  title: string;
  message: string;
  actions?: { href: string; label: string; external?: boolean }[];
};

export function renderPlaceholderPage(
  currentPath: string,
  copy: PlaceholderCopy,
  options: { description?: string; status?: number } = {}
): Response {
  const actionsHtml = (copy.actions || [])
    .map((action) => {
      const rel = action.external ? ' rel="noopener noreferrer" target="_blank"' : '';
      return `<a class="button${action.external ? ' secondary' : ''}" href="${action.href}"${rel}>${escapeHtml(
        action.label
      )}</a>`;
    })
    .join('');

  const body = `
    <section class="hero">
      <p class="pill">${escapeHtml(copy.title)}</p>
      <h1>Coming soon</h1>
      <p>${escapeHtml(copy.message)}</p>
      ${actionsHtml ? `<div class="button-row">${actionsHtml}</div>` : ''}
    </section>
  `;

  return renderPage({
    title: copy.title,
    description: options.description,
    body,
    currentPath,
    status: options.status,
  });
}

export function renderHomePage(currentPath: string): Response {
  const body = `
    <section class="hero">
      <p class="pill">Community powered business magic</p>
      <h1>Welcome to Messy &amp; Magnetic</h1>
      <p class="muted">A home for creators, supporters, and big-hearted projects. Explore our donor wall, take the brand quiz, or swing by the shop to see what we are crafting next.</p>
      <div class="button-row">
        <a class="button" href="/donors">Meet our donors</a>
        <a class="button secondary" href="/quiz">Try the brand quiz</a>
      </div>
    </section>
    <section class="section">
      <h2>Here is what we are building</h2>
      <p class="muted">Messy &amp; Magnetic is the studio supporting Maggie and the crew behind the scenes. We are rolling out a refreshed online experience with space for donors, digital offerings, and pop-up experiments. Thanks for stopping by while the paint dries.</p>
    </section>
  `;

  return renderPage({
    title: 'Messy & Magnetic',
    description: 'Landing page for Messy & Magnetic with quick links to donors, quiz, shop, and about.',
    body,
    currentPath,
  });
}
