import { describe, expect, test } from 'vitest';
import { createAdmin } from '../account/bootstrap.js';
import { importBags } from '../bag/import.js';
import { pasteLimits } from '../contract/bag-json.js';
import { fixture, sessionCookie, setup } from './test-support.js';

/** An admin with the fixture's five bags, so every list has rows. */
async function withBags() {
  const env = setup();
  const admin = createAdmin(env.db, new Date('2026-10-12T12:00:00Z'));
  const cookie = sessionCookie(
    await env.request('/sign-in', { form: { account_number: admin.accountNumber } }),
  ) as string;
  const adminId = Number(env.db.prepare('SELECT id FROM account WHERE is_admin = 1').get()?.id);
  importBags(env.db, adminId, JSON.stringify(fixture), { limits: pasteLimits });
  return { ...env, cookie, adminId };
}

/** The inside of the page's live region `name`, as the app's script swaps it in. */
function region(html: string, name: string): string | undefined {
  const open = `<div data-live-region="${name}">`;
  const start = html.indexOf(open);
  if (start === -1) return undefined;
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = start + open.length;
  for (let depth = 1, tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
    depth += tag[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start + open.length, tag.index);
  }
  return undefined;
}

describe('live filters and searches', () => {
  test('each filter and search form applies as it changes, and its results sit in a region the script swaps', async () => {
    const { request, cookie } = await withBags();
    const pages: [path: string, filtered: string, shown: string, hidden: string][] = [
      ['/', '/?roaster=Tanat', 'Panama - Elida', 'Ethiopia Sasaba'],
      ['/pool', '/pool?q=Elida', 'Panama - Elida', 'Ethiopia Sasaba'],
      ['/add/pool', '/add/pool?q=Elida', 'Panama - Elida', 'Ethiopia Sasaba'],
      ['/admin/coffees', '/admin/coffees?q=Elida', 'Panama - Elida', 'Ethiopia Sasaba'],
      ['/roasters', '/roasters?q=Tanat', 'Tanat', 'Sasaba'],
    ];
    for (const [path, filtered, shown, hidden] of pages) {
      const page = await (await request(path, { cookie })).text();
      expect([path, page]).toEqual([path, expect.stringMatching(/<form class="filters" method="get"[^>]* data-live/)]);
      expect([path, region(page, 'results')]).toEqual([path, expect.any(String)]);

      const results = region(await (await request(filtered, { cookie })).text(), 'results');
      expect([filtered, results]).toEqual([filtered, expect.stringContaining(shown)]);
      expect([filtered, results]).toEqual([filtered, expect.not.stringContaining(hidden)]);
    }
  });

  test('the roasters’ tabs follow the search too', async () => {
    const { request, cookie } = await withBags();
    expect(region(await (await request('/roasters?q=Tan', { cookie })).text(), 'tabs')).toContain(
      'href="/roasters?q=Tan&amp;only=bags"',
    );
  });

  test('the theme saves as it changes; the state and the time zone keep their button, as an arrow key changes a select', async () => {
    const { db, request, cookie, adminId } = await withBags();
    const bagId = Number(db.prepare('SELECT min(id) AS id FROM bag WHERE account_id = ?').get(adminId)?.id);
    const bag = await (await request(`/bags/${bagId}`, { cookie })).text();
    expect(bag).toMatch(/<form method="post" action="\/bags\/\d+\/state" class="state-form">/);
    const account = await (await request('/account', { cookie })).text();
    expect(account).toMatch(/<form method="post" action="\/account\/time-zone" class="actions">/);
    expect(account).toMatch(/<form method="post" action="\/account\/theme" class="actions" data-auto-submit[=">]/);
  });

  test('the buttons the script hides stay hidden, though a button is styled to show', async () => {
    const { request } = setup();
    const css = await (await request('/assets/app.css')).text();
    expect(css).toContain('[hidden] { display: none !important; }');
    const script = await (await request('/assets/app.js')).text();
    expect(script).toContain('form[data-live]');
    expect(script).toContain('form[data-auto-submit]');
  });
});
