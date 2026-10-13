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

  test('draws its charts with Chart.js, served by the app and loaded on this page only', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const bought = ['2026-09-03', '2026-09-20', '2026-10-01'];
    for (const [index, day] of bought.entries()) {
      const input = structuredClone(fixture.bags[index]);
      input.personal = { price: { cents: 2000, currency: 'EUR' }, bought_on: day };
      if (addBag(db, me.accountId, input).status !== 'saved') throw new Error('Not saved');
    }

    const html = await (await request('/stats', { cookie: me.cookie })).text();
    const script =
      /<script src="(\/assets\/chart\.js\?v=[0-9a-f]{10})" defer=""><\/script><script src="\/assets\/app\.js/.exec(
        html,
      );
    expect(script).not.toBeNull();
    const charts = [
      ...html.matchAll(/<div class="chart" hidden="" aria-hidden="true"><canvas data-chart="([^"]+)"/g),
    ].map((m) => JSON.parse((m[1] as string).replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
    expect(charts.map((chart) => chart.kind)).toEqual(['rows', 'bars', 'spending']);
    expect(charts[0]).toEqual({
      kind: 'rows',
      labels: expect.arrayContaining(['Mixed Heirloom', 'Caturra']),
      bags: expect.any(Array),
      ratings: expect.any(Array),
    });
    expect(charts[2]).toEqual({
      kind: 'spending',
      currency: 'EUR',
      labels: [expect.stringMatching(/^Sept? 2026$/), 'Oct 2026'],
      spent: [40, 20],
      per100g: expect.any(Array),
    });

    const library = await request(script?.[1] as string);
    expect(library.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const code = await library.text();
    expect(code).toContain('window.Chart=');
    expect(code).not.toContain('sourceMappingURL');
    expect(await (await request('/', { cookie: me.cookie })).text()).not.toContain('/assets/chart.js');
  });
});
