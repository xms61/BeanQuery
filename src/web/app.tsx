import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { accountForSession } from '../account/account.js';
import { isTimeZone } from '../account/time-zone.js';
import { isAdmin } from '../admin/admin.js';
import { appScript, styleSheet } from './assets/style.js';
import { type Env, type Limits, sessionCookieName, setSessionCookie, type WebConfig } from './context.js';
import { AppPage, CardPage } from './layout.js';
import { RateLimiter } from './rate-limit.js';
import { accountRoutes } from './routes/account.js';
import { addRoutes } from './routes/add.js';
import { adminRoutes } from './routes/admin.js';
import { bagActionRoutes } from './routes/bag-actions.js';
import { editRoutes } from './routes/edit.js';
import { libraryRoutes } from './routes/library.js';
import { pageRoutes } from './routes/pages.js';
import { poolRoutes } from './routes/pool.js';

export function createApp(config: WebConfig): Hono<Env> {
  // Checked here, at start, so a typo stops the server instead of failing every signed-in page later.
  if (!isTimeZone(config.defaultTimeZone)) {
    throw new Error(
      `DEFAULT_TIME_ZONE ${JSON.stringify(config.defaultTimeZone)} is not a time zone, such as Europe/Berlin`,
    );
  }
  const app = new Hono<Env>();
  // Ten sign-ins per quarter hour, and five invite codes per hour, per client.
  const limits: Limits = { signIn: new RateLimiter(10, 15 * 60_000), redeem: new RateLimiter(5, 60 * 60_000) };

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );
  app.use(config.origin === undefined ? csrf() : csrf({ origin: config.origin }));
  // Before any route parses a body. A paste is at most 256 KB of JSON, which form encoding can about triple.
  const formLimit = bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) =>
      c.html(
        <CardPage title="Too large">
          <h1>Too large</h1>
          <p class="muted">That was more than 1 MB.</p>
        </CardPage>,
        413,
      ),
  });
  // An export upload (/import) and a saved roaster page (/admin/roasters/upload) set their own, larger limits.
  const ownLimit = new Set(['/import', '/admin/roasters/upload']);
  app.use((c, next) => (ownLimit.has(c.req.path) ? next() : formLimit(c, next)));
  app.use(async (c, next) => {
    // The assets are public and cacheable: no session is read or renewed, so no cache can keep a session cookie.
    if (c.req.path.startsWith('/assets/')) return next();
    c.set('config', config);
    c.set('limits', limits);
    const token = getCookie(c, sessionCookieName(config));
    const accountId = token === undefined ? null : accountForSession(config.db, token, config.now());
    c.set('accountId', accountId);
    c.set('admin', accountId !== null && isAdmin(config.db, accountId));
    await next();
    // Renew the cookie with the session, unless the route set or cleared it (signing in or out, deleting).
    const setsSession = c.res.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith(`${sessionCookieName(config)}=`));
    if (token !== undefined && accountId !== null && !setsSession) setSessionCookie(c, token);
    // Pages carry personal data and, once, an account number: no cache keeps them.
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });

  app.get('/assets/app.css', (c) =>
    c.body(styleSheet, 200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }),
  );
  app.get('/assets/app.js', (c) =>
    c.body(appScript, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }),
  );

  app.route('/', accountRoutes);
  app.route('/', libraryRoutes);
  app.route('/', bagActionRoutes);
  app.route('/', addRoutes);
  app.route('/', editRoutes);
  app.route('/', poolRoutes);
  app.route('/', adminRoutes);
  app.route('/', pageRoutes);

  // Logged without the request, so no address, cookie or pasted text reaches the log; the page says nothing internal.
  app.onError((error, c) => {
    // A refusal from middleware, such as the CSRF check (403), keeps its status and says nothing more.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.html(
      <CardPage title="Something went wrong">
        <h1>Something went wrong</h1>
        <p class="muted">Nothing was saved. Try again, and if it keeps happening, tell the friend who invited you.</p>
        <a href="/">Back to the library</a>
      </CardPage>,
      500,
    );
  });
  app.notFound((c) => {
    const page = (
      <>
        <h1>Not found</h1>
        <p class="muted">There is nothing at this address.</p>
      </>
    );
    return c.html(
      c.get('accountId') === null ? (
        <CardPage title="Not found">
          {page}
          <a href="/sign-in">Sign in</a>
        </CardPage>
      ) : (
        <AppPage title="Not found" section="library" admin={c.get('admin')}>
          {page}
        </AppPage>
      ),
      404,
    );
  });
  return app;
}
