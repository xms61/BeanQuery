import type { Child } from 'hono/jsx';
import { assetVersion } from './assets/style.js';
import { pageTheme } from './context.js';

/** The current section of the app, which the sidebar marks. */
export type Section = 'library' | 'pool' | 'add' | 'roasters' | 'gear' | 'account' | 'admin' | 'impressum';

function Document(props: { title: string; children: Child }) {
  const theme = pageTheme();
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · BeanQuery`}</title>
        <link rel="stylesheet" href={`/assets/app.css?v=${assetVersion}`} />
        <script src={`/assets/app.js?v=${assetVersion}`} defer></script>
      </head>
      <body>{props.children}</body>
    </html>
  );
}

/** A page inside the app, with the sidebar and the footer. */
export function AppPage(props: { title: string; section: Section; admin: boolean; children: Child }) {
  const current = (section: Section) => (props.section === section ? 'page' : undefined);
  return (
    <Document title={props.title}>
      <div class="shell">
        <nav class="side" aria-label="Main">
          <a class="brand" href="/">
            <BeanIcon /> BeanQuery
          </a>
          <a class="nav" href="/" aria-current={current('library')}>
            Library
          </a>
          <a class="nav" href="/pool" aria-current={current('pool')}>
            Pool
          </a>
          <a class="nav" href="/add" aria-current={current('add')}>
            Add bag
          </a>
          <a class="nav" href="/roasters" aria-current={current('roasters')}>
            Roasters
          </a>
          <a class="nav" href="/gear" aria-current={current('gear')}>
            Gear
          </a>
          {props.admin && (
            <a class="nav" href="/admin" aria-current={current('admin')}>
              Admin
            </a>
          )}
          <a class="nav bottom" href="/account" aria-current={current('account')}>
            Account
          </a>
        </nav>
        <main>
          {props.children}
          <footer class="small">
            <a href="/impressum">Impressum</a>
            <span class="muted">BeanQuery, a coffee log for a few friends. Non-commercial.</span>
          </footer>
        </main>
      </div>
    </Document>
  );
}

/** A page outside the app, for signing in and redeeming an invite: one card in the middle. */
export function CardPage(props: { title: string; wide?: boolean; children: Child }) {
  return (
    <Document title={props.title}>
      <div class="center">
        <div class={props.wide ? 'card wide' : 'card'}>{props.children}</div>
      </div>
    </Document>
  );
}

function BeanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <ellipse cx="10" cy="10" rx="7" ry="9" fill="currentColor" />
      <path d="M10 1.5c-2.5 3-2.5 6 0 8.5s2.5 5.5 0 8.5" stroke="var(--bg-sunk)" stroke-width="1.6" fill="none" />
    </svg>
  );
}
