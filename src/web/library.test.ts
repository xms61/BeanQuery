import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { setTimeZone } from '../account/time-zone.js';
import { addBag } from '../bag/manage.js';
import { fixture, redeemed, setup } from './test-support.js';

const plan = {
  rest: { from: 28, to: 35 },
  peak: { from: 30, to: 60 },
  portion: { from: 28, to: 30 },
  mid_peak: 45,
  tubes: 16,
  dial_in_g: 10,
};

/** Adds fixture bag `index` for an account, roasted on `roastDate` with the plan above, and returns its id. */
function bag(
  db: DatabaseSync,
  accountId: number,
  index: number,
  roastDate: string,
  change: (b: Record<string, unknown>) => void = () => {},
) {
  const input = structuredClone(fixture.bags[index]);
  input.roast_date = { printed: roastDate, date: roastDate, status: 'verified' };
  input.plan = structuredClone(plan);
  change(input);
  const result = addBag(db, accountId, input);
  if (result.status !== 'saved') throw new Error(JSON.stringify(result));
  return Number(db.prepare('SELECT max(id) AS id FROM bag').get()?.id);
}

describe('the library', () => {
  test('lists only the account’s own bags, with their phase, and filters them', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    // Day 53, open: in peak, with no toast or upcoming event, which ignore the filters.
    bag(db, me.accountId, 0, '2026-08-20', (b) => {
      b.personal = { state: 'open' };
    });
    bag(db, me.accountId, 2, '2026-10-01');
    bag(db, them.accountId, 1, '2026-10-01');

    const html = await (await request('/', { cookie: me.cookie })).text();
    expect(html).toContain('Ethiopia Sasaba');
    expect(html).toContain('Panama - Elida');
    expect(html).not.toContain('Peru La Danta');
    expect(html).toContain('2 bags');
    expect(html).toContain('In peak');
    expect(html).toContain('Resting');

    const tanat = await (await request('/?roaster=Tanat', { cookie: me.cookie })).text();
    expect(tanat).toContain('Panama - Elida');
    expect(tanat).not.toContain('Ethiopia Sasaba');
    const nothing = await (await request('/?phase=past&rating=nonsense&state=bogus', { cookie: me.cookie })).text();
    expect(nothing).toContain('No bag matches these filters.');
  });

  test('escapes text that came from a paste, wherever it is shown', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const id = bag(db, me.accountId, 0, '2026-09-01', (b) => {
      (b.coffee as Record<string, unknown>).name = '<img src=x onerror=alert(1)>';
      (b.coffee as Record<string, unknown>).tasting_notes = ['<script>alert(2)</script>'];
    });
    for (const path of ['/', `/bags/${id}`, '/?q=%3Cimg']) {
      const html = await (await request(path, { cookie: me.cookie })).text();
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<script>alert');
    }
  });

  test('shows due toasts and "Coming up" by the user’s own day, which can start before UTC’s', async () => {
    const { db, clock, request } = setup();
    const me = await redeemed(request, db);
    // The portion window opens on day 28: 2026-10-13 for a bag roasted on 2026-09-15.
    bag(db, me.accountId, 0, '2026-09-15');
    clock.now = new Date('2026-10-12T22:30:00Z');

    const utc = await (await request('/', { cookie: me.cookie })).text();
    expect(utc).not.toContain('class="toast portion"');
    expect(utc).toContain('Tue 13 Oct');

    setTimeZone(db, me.accountId, 'Europe/Berlin');
    const berlin = await (await request('/', { cookie: me.cookie })).text();
    expect(berlin).toContain('class="toast portion"');
    expect(berlin).toContain('Done: frozen');
  });

  test('"Done: frozen" sets the bag’s state and clears the toast; "Dismiss" clears a mid-peak toast', async () => {
    const { db, clock, request } = setup();
    const me = await redeemed(request, db);
    const portion = bag(db, me.accountId, 0, '2026-09-14');
    const midPeak = bag(db, me.accountId, 1, '2026-08-28', (b) => {
      b.personal = { state: 'frozen' };
    });
    clock.now = new Date('2026-10-12T12:00:00Z');
    const page = await (await request('/', { cookie: me.cookie })).text();
    expect(page).toContain('class="toast portion"');
    expect(page).toContain('class="toast mid_peak"');

    const done = await request(`/bags/${portion}/state`, {
      form: { state: 'frozen', from: 'library' },
      cookie: me.cookie,
    });
    expect([done.status, done.headers.get('location')]).toEqual([303, '/']);
    const dismissed = await request(`/bags/${midPeak}/dismiss-mid-peak`, { form: {}, cookie: me.cookie });
    expect(dismissed.status).toBe(303);

    const after = await (await request('/', { cookie: me.cookie })).text();
    expect(after).not.toContain('class="toast');
    expect(db.prepare('SELECT state FROM bag WHERE id = ?').get(portion)).toEqual({ state: 'frozen' });
  });
});

describe('a bag’s page', () => {
  test('shows the plan dates and today’s phase to its account only', async () => {
    const { db, clock, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    const id = bag(db, me.accountId, 0, '2026-09-18');
    clock.now = new Date('2026-10-07T12:00:00Z');

    const html = await (await request(`/bags/${id}`, { cookie: me.cookie })).text();
    expect(html).toContain('Day +19. Keep sealed. Open, portion and freeze between 16 October and 18 October.');
    expect(html).toContain('16 to 23 Oct');
    expect(html).toContain('18 Oct to 17 Nov');
    expect(html).toContain('In the pool');

    expect((await request(`/bags/${id}`, { cookie: them.cookie })).status).toBe(404);
    expect((await request('/bags/abc', { cookie: me.cookie })).status).toBe(404);
    expect((await request(`/bags/${id}`)).status).toBe(303);
  });

  test('sets the state of an own bag only, and only to a real state', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    const id = bag(db, me.accountId, 0, '2026-09-18');

    expect((await request(`/bags/${id}/state`, { form: { state: 'finished' }, cookie: them.cookie })).status).toBe(404);
    expect((await request(`/bags/${id}/state`, { form: { state: 'gone' }, cookie: me.cookie })).status).toBe(404);
    expect(db.prepare('SELECT state FROM bag WHERE id = ?').get(id)).toEqual({ state: 'sealed' });

    const set = await request(`/bags/${id}/state`, { form: { state: 'finished' }, cookie: me.cookie });
    expect([set.status, set.headers.get('location')]).toEqual([303, `/bags/${id}`]);
    expect(db.prepare('SELECT state FROM bag WHERE id = ?').get(id)).toEqual({ state: 'finished' });
  });
});

describe('the time zone', () => {
  test('is taken from the browser on sign-in, ignored when it is not a zone, and can be changed', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const zone = () => db.prepare('SELECT time_zone FROM account WHERE id = ?').get(me.accountId)?.time_zone;
    expect(zone()).toBeNull();

    await request('/sign-in', { form: { account_number: me.number, time_zone: 'Mars/Olympus' } });
    expect(zone()).toBeNull();
    await request('/sign-in', { form: { account_number: me.number, time_zone: 'America/New_York' } });
    expect(zone()).toBe('America/New_York');

    expect(await (await request('/account', { cookie: me.cookie })).text()).toContain('America/New York');
    const changed = await request('/account/time-zone', { form: { time_zone: 'Europe/Berlin' }, cookie: me.cookie });
    expect(changed.status).toBe(303);
    expect(zone()).toBe('Europe/Berlin');
    expect((await request('/account/time-zone', { form: { time_zone: 'nope' }, cookie: me.cookie })).status).toBe(400);
  });
});
