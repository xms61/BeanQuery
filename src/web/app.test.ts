import { describe, expect, test } from 'vitest';
import { createInvite, redeemInvite } from '../account/account.js';
import { createAdmin } from '../account/bootstrap.js';
import { addBag } from '../bag/manage.js';
import { fixture, numberPattern, redeemed, sessionCookie, setup } from './test-support.js';

describe('signed-out visitors', () => {
  test('are sent to sign in from every page of the app, and see only the account pages and the Impressum', async () => {
    const { request } = setup();
    for (const path of ['/', '/account', '/account/export.json', '/account/delete']) {
      const response = await request(path);
      expect([path, response.status, response.headers.get('location')]).toEqual([path, 303, '/sign-in']);
    }
    expect((await request('/sign-in')).status).toBe(200);
    expect((await request('/redeem')).status).toBe(200);
    expect(await (await request('/impressum')).text()).toContain('your friendly neighborhood brewer');
    expect((await request('/nowhere')).status).toBe(404);
  });

  test('get pages with a strict content policy, and no page is cached', async () => {
    const { request } = setup();
    const response = await request('/sign-in');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d{8}/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await request('/assets/app.css')).headers.get('content-type')).toContain('text/css');
    // Pages link the assets by a hash of their content, so a deploy's new ones are fetched despite the long cache.
    expect(await response.text()).toMatch(/href="\/assets\/app\.css\?v=[0-9a-f]{10}"/);
  });

  test('get the design’s fonts from the app itself, each linked from the stylesheet by a hash of its bytes', async () => {
    const { request } = setup();
    const css = await (await request('/assets/app.css')).text();
    const urls = [...css.matchAll(/url\('(\/assets\/fonts\/[a-z-]+\.woff2\?v=[0-9a-f]{10})'\)/g)].map((m) => m[1]);
    expect(urls).toHaveLength(4);
    expect(css).toContain("font-family: 'Familjen Grotesk'");
    expect(css).toContain("font-family: 'JetBrains Mono'");
    for (const url of urls) {
      const font = await request(url as string);
      expect([url, font.status, font.headers.get('content-type')]).toEqual([url, 200, 'font/woff2']);
      expect(font.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(new TextDecoder().decode((await font.arrayBuffer()).slice(0, 4))).toBe('wOF2');
    }
    for (const path of [
      '/assets/fonts/OFL-jetbrains-mono.txt',
      '/assets/fonts/..%2Fstyle.ts',
      '/assets/fonts/x.woff2',
    ]) {
      expect([path, (await request(path)).status]).toEqual([path, 404]);
    }
  });
});

describe('the health check', () => {
  test('answers while the database does, without a session, and fails once it does not', async () => {
    const { db, request } = setup();
    const { cookie } = await redeemed(request, db);
    const healthy = await request('/healthz', { cookie });
    expect([healthy.status, await healthy.text(), healthy.headers.get('set-cookie')]).toEqual([200, 'ok', null]);
    expect(healthy.headers.get('cache-control')).toBe('no-store');

    db.close();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const failing = await request('/healthz');
      expect([failing.status, await failing.text()]).toEqual([503, 'database unavailable']);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});

describe('redeeming an invite', () => {
  test('creates an account, shows its number once, and signs in with a secure session cookie', async () => {
    const { db, request } = setup();
    const { code } = createInvite(db, new Date('2026-10-12T12:00:00Z'));
    const response = await request('/redeem', { form: { code: code.toLowerCase().replace(/ /g, '-') } });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(numberPattern);
    expect(html).toContain('shown only now');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=7776000/);

    const library = await request('/', { cookie: sessionCookie(response) as string });
    expect(library.status).toBe(200);
    expect(await library.text()).toContain('0 bags');
  });

  test('answers an unknown, used or expired code alike, and escapes what was typed', async () => {
    const { db, clock, request } = setup();
    const { code } = createInvite(db, clock.now);
    redeemInvite(db, code, clock.now);
    const expired = createInvite(db, clock.now).code;
    clock.now = new Date('2026-11-12T12:00:00Z');

    for (const entered of [code, expired, '<script>alert(1)</script>']) {
      const response = await request('/redeem', { form: { code: entered }, headers: { 'x-test-client': entered } });
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain('That invite code is unknown, used or expired.');
      expect(html).not.toContain('<script>alert(1)');
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  test('is limited to five codes an hour per client', async () => {
    const { db, clock, request } = setup();
    for (let i = 0; i < 5; i++) expect((await request('/redeem', { form: { code: 'WRONG' } })).status).toBe(400);
    const { code } = createInvite(db, clock.now);
    expect((await request('/redeem', { form: { code } })).status).toBe(429);
    expect((await request('/redeem', { form: { code }, headers: { 'x-test-client': 'client-b' } })).status).toBe(200);
  });
});

describe('signing in', () => {
  test('with the account number, written any way, starts a session', async () => {
    const { db, request } = setup();
    const { number } = await redeemed(request, db);
    const response = await request('/sign-in', { form: { account_number: number.toLowerCase().replace(/ /g, '') } });
    expect([response.status, response.headers.get('location')]).toEqual([303, '/']);
    expect((await request('/', { cookie: sessionCookie(response) as string })).status).toBe(200);
  });

  test('with a wrong number is refused, and after ten tries even the right number waits', async () => {
    const { db, request } = setup();
    const { number } = await redeemed(request, db);
    const wrong = await request('/sign-in', { form: { account_number: 'AAAA AAAA AAAA AAAA AAAA' } });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('No account has that number.');
    for (let i = 0; i < 9; i++) await request('/sign-in', { form: { account_number: 'nope' } });
    expect((await request('/sign-in', { form: { account_number: number } })).status).toBe(429);
  });

  test('refuses a form posted from another site', async () => {
    const { db, request } = setup();
    const { number } = await redeemed(request, db);
    const response = await request('/sign-in', {
      form: { account_number: number },
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
  });

  test('without HTTPS in development uses a plain cookie name without Secure', async () => {
    const { db, request } = setup({ secureCookies: false });
    const { code } = createInvite(db, new Date('2026-10-12T12:00:00Z'));
    const cookie = (await request('/redeem', { form: { code } })).headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^session=/);
    expect(cookie).not.toMatch(/Secure/);
  });
});

describe('sessions', () => {
  test('are not renewed on the public, cacheable assets, so no cache can keep a session cookie', async () => {
    const { db, request } = setup();
    const { cookie } = await redeemed(request, db);
    for (const path of ['/assets/app.css', '/assets/app.js']) {
      const response = await request(path, { cookie });
      expect([path, response.headers.get('cache-control')]).toEqual([path, 'public, max-age=31536000, immutable']);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  test('the stylesheet’s dark tokens follow the system unless the page says light, and always a dark page', async () => {
    const { request } = setup();
    const css = await (await request('/assets/app.css')).text();
    expect(css).toMatch(/:root\[data-theme="dark"\] \{\s+color-scheme: dark;\s+--bg-ground: #1B1613;/);
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s+:root:not\(\[data-theme="light"\]\) \{\s+--bg-ground: #1B1613;/,
    );
  });

  test('renew the cookie on use, and end after 90 days unused', async () => {
    const { db, clock, request } = setup();
    const { cookie } = await redeemed(request, db);
    clock.now = new Date('2026-12-01T12:00:00Z');
    const used = await request('/', { cookie });
    expect(used.status).toBe(200);
    expect(used.headers.get('set-cookie')).toMatch(/Max-Age=7776000/);

    clock.now = new Date('2027-03-02T12:00:00Z');
    expect((await request('/', { cookie })).status).toBe(303);
  });

  test('sign out ends this session; sign out everywhere ends every session of the account', async () => {
    const { db, request } = setup();
    const { number, cookie } = await redeemed(request, db);
    const other = sessionCookie(await request('/sign-in', { form: { account_number: number } })) as string;
    const third = sessionCookie(await request('/sign-in', { form: { account_number: number } })) as string;

    expect((await request('/sign-out', { form: {}, cookie })).headers.get('location')).toBe('/sign-in');
    expect((await request('/', { cookie })).status).toBe(303);
    expect((await request('/', { cookie: other })).status).toBe(200);

    await request('/account/sign-out-everywhere', { form: {}, cookie: other });
    expect((await request('/', { cookie: other })).status).toBe(303);
    expect((await request('/', { cookie: third })).status).toBe(303);
  });
});

describe('the account page', () => {
  test('counts the bags, and exports only this account’s bags as a JSON file', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    const myId = Number(db.prepare('SELECT max(id) - 1 AS id FROM account').get()?.id);
    addBag(db, myId, structuredClone(fixture.bags[0]));
    const secret = structuredClone(fixture.bags[1]);
    secret.personal = { private: true };
    addBag(db, myId, secret);
    addBag(db, myId + 1, structuredClone(fixture.bags[0]));

    expect(await (await request('/account', { cookie: me.cookie })).text()).toContain('2, 1 of them private');
    const file = await request('/account/export.json', { cookie: me.cookie });
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="beanquery-bags-2026-10-12.json"');
    const exported = JSON.parse(await file.text());
    expect(exported.schema).toBe('beanquery.bags/v1');
    expect(exported.bags.map((b: { coffee: { name: string } }) => b.coffee.name)).toEqual([
      'Ethiopia Sasaba',
      'Peru La Danta',
    ]);
    expect(JSON.parse(await (await request('/account/export.json', { cookie: them.cookie })).text()).bags).toHaveLength(
      1,
    );

    const csv = await request('/account/export.csv', { cookie: me.cookie });
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="beanquery-bags-2026-10-12.csv"');
    expect((await csv.text()).split('\r\n').filter(Boolean)).toHaveLength(3);
    expect((await request('/account/export.csv')).status).toBe(303);
  });

  test('deletes the account only when confirmed, then signs out', async () => {
    const { db, request } = setup();
    const { cookie } = await redeemed(request, db);
    expect((await request('/account/delete', { form: {}, cookie })).status).toBe(400);
    expect(db.prepare('SELECT count(*) AS n FROM account').get()).toEqual({ n: 1 });

    const deleted = await request('/account/delete', { form: { confirm: 'yes' }, cookie });
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get('set-cookie')).toMatch(/^__Host-session=;/);
    expect(db.prepare('SELECT count(*) AS n FROM account').get()).toEqual({ n: 0 });
    expect((await request('/', { cookie })).status).toBe(303);
  });

  test('shows the admin link only to an admin', async () => {
    const { db, request } = setup();
    const user = await redeemed(request, db);
    const admin = createAdmin(db, new Date('2026-10-12T12:00:00Z'));
    const adminCookie = sessionCookie(await request('/sign-in', { form: { account_number: admin.accountNumber } }));

    expect(await (await request('/', { cookie: user.cookie })).text()).not.toContain('href="/admin"');
    expect(await (await request('/', { cookie: adminCookie as string })).text()).toContain('href="/admin"');
  });
});

describe('limits and failures', () => {
  test('a body over 1 MB is refused before it is parsed', async () => {
    const { request } = setup();
    const response = await request('/sign-in', { form: { account_number: 'A'.repeat(1024 * 1024) } });
    expect(response.status).toBe(413);
  });

  test('an unexpected error shows a generic page, without its message or stack', async () => {
    const { app, request } = setup();
    app.get('/boom', () => {
      throw new Error('SELECT secret FROM somewhere');
    });
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const response = await request('/boom');
      expect(response.status).toBe(500);
      const html = await response.text();
      expect(html).toContain('Something went wrong');
      expect(html).not.toContain('SELECT secret');
      expect(html).not.toContain('at ');
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});

describe('the app’s settings', () => {
  test('refuse a default time zone that is not one, before any page can fail on it', () => {
    expect(() => setup({ defaultTimeZone: 'Europe/Berlín' })).toThrow(/DEFAULT_TIME_ZONE/);
  });
});

describe('the skip link', () => {
  test('is the first link on every app page and jumps to the main content', async () => {
    const { request, db } = setup();
    const { cookie } = await redeemed(request, db);
    for (const path of ['/', '/pool', '/add', '/stats', '/account']) {
      const html = await (await request(path, { cookie })).text();
      const firstLink = /<a [^>]*>[^<]*/.exec(html.slice(html.indexOf('<body>')))?.[0];
      expect([path, firstLink]).toEqual([path, '<a class="skip-link" href="#main">Skip to content']);
      expect([path, html.includes('<main id="main" tabindex="-1">')]).toEqual([path, true]);
    }
  });

  test('is hidden until it has the keyboard focus', async () => {
    const css = await (await setup().request('/assets/app.css')).text();
    expect(css).toMatch(/\.skip-link \{[^}]*position: absolute[^}]*\}/);
    expect(css).toMatch(/\.skip-link:not\(:focus\)[^{]*\{[^}]*clip-path: inset\(50%\)/);
  });
});
