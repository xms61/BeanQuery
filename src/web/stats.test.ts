import { describe, expect, test } from 'vitest';
import { addBag } from '../bag/manage.js';
import { fixture, redeemed, setup } from './test-support.js';

describe('the stats page', () => {
  test('shows the account’s own bags on the map and in the tables, and nothing of another account’s', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    expect((await request('/stats')).status).toBe(303);
    expect(await (await request('/stats', { cookie: me.cookie })).text()).toContain('No bags yet.');

    const add = (accountId: number, index: number, change: (b: Record<string, unknown>) => void = () => {}) => {
      const input = structuredClone(fixture.bags[index]);
      change(input);
      const result = addBag(db, accountId, input);
      if (result.status !== 'saved') throw new Error(JSON.stringify(result));
    };
    add(me.accountId, 2, (b) => {
      b.personal = { rating: 4.5, price: { cents: 1800, currency: 'EUR' }, bought_on: '2026-10-03' };
    });
    add(me.accountId, 0);
    add(me.accountId, 1, (b) => {
      (b.coffee as Record<string, unknown>).country = '<img src=x onerror=alert(1)>';
    });
    add(them.accountId, 1, (b) => {
      (b.coffee as Record<string, unknown>).country = 'Kenya';
    });

    const html = await (await request('/stats', { cookie: me.cookie })).text();
    expect(html).toContain('3 bags, private ones included');
    expect(html).toMatch(/<path d="[^"]+" class="tried m4"><title>Panama: 1 bag, rated 4\.5 on average<\/title>/);
    expect(html).toMatch(/class="tried m4"><title>Ethiopia: 1 bag<\/title>/);
    expect(html).toContain('<title>Kenya</title>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Not on the map, as written on your bags: &lt;img src=x onerror=alert(1)&gt;.');
    expect(html).toContain('1600 to 1800 m');
    expect(html).toContain('Oct 2026');
    expect(html).toContain('€18.00');
    expect(html).toContain('€7.20');
    expect(html).toContain('aria-current="page">Stats');
  });
});
