import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { importBags } from '../bag/import.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { accountStats, matchCountries } from './stats.js';
import { worldMap } from './world-map.data.js';
import { buildWorldMap, nameKey } from './world-map-build.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
) as { bags: Record<string, unknown>[] };

/** Two accounts, each with the fixture's five bags: Ethiopia twice, Peru, and Panama twice. */
function withBags() {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-13', '2026-10-13'), (2, randomblob(32), '2026-10-13', '2026-10-13')`);
  for (const account of [1, 2]) {
    const result = importBags(db, account, JSON.stringify(fixture), { limits: pasteLimits });
    if (result.status !== 'saved') throw new Error(JSON.stringify(result));
  }
  const bag = (account: number, coffee: string) =>
    Number(
      db
        .prepare('SELECT b.id FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.account_id = ? AND c.name LIKE ?')
        .get(account, `%${coffee}%`)?.id,
    );
  return { db, bag };
}

describe('matching a bag’s country to the map', () => {
  test('takes Natural Earth’s names, common spellings and blends, and reports what it can’t place', () => {
    const ids = (text: string) => matchCountries(text).matched.map((c) => c.id);
    expect(ids('Ethiopia')).toEqual(['ETH']);
    expect(ids('  côte d’ivoire ')).toEqual(['CIV']);
    expect(ids('Ivory Coast')).toEqual(['CIV']);
    expect(ids('DR Congo')).toEqual(['COD']);
    expect(ids('Democratic Republic of the Congo')).toEqual(['COD']);
    expect(ids('the United States of America')).toEqual(['USA']);
    expect(ids('Hawaii')).toEqual(['USA']);
    expect(ids('Brazil, Ethiopia / Kenya')).toEqual(['BRA', 'ETH', 'KEN']);
    expect(ids('Bosnia and Herzegovina')).toEqual(['BIH']);
    expect(matchCountries('Colombia & Atlantis')).toEqual({
      matched: [expect.objectContaining({ id: 'COL' })],
      unmatched: ['Atlantis'],
    });
  });

  test('every coffee-growing country the owner may meet is on the map', () => {
    const growers = 'Brazil Vietnam Colombia Indonesia Ethiopia Honduras India Uganda Mexico Guatemala Peru Nicaragua';
    const more = 'Kenya Rwanda Burundi Tanzania Yemen Panama Bolivia Ecuador Myanmar Laos China Malawi Zambia';
    for (const name of [...growers.split(' '), ...more.split(' '), 'Costa Rica', 'El Salvador', 'Papua New Guinea']) {
      expect([name, matchCountries(name).matched.length]).toEqual([name, 1]);
    }
  });
});

describe('an account’s statistics', () => {
  test('count only its own bags, with the average of the rated ones', () => {
    const { db, bag } = withBags();
    db.prepare("UPDATE bag SET rating = 4.5, rated_on = '2026-10-13' WHERE id = ?").run(bag(1, 'Elida'));
    db.prepare("UPDATE bag SET rating = 3.5, rated_on = '2026-10-13' WHERE id = ?").run(bag(1, 'Audaura'));
    db.prepare("UPDATE bag SET rating = 1, rated_on = '2026-10-13' WHERE id = ?").run(bag(2, 'Elida'));
    db.prepare("UPDATE coffee SET country = 'Atlantis' WHERE name LIKE '%La Danta%'").run();

    const stats = accountStats(db, 1);
    expect(stats.bags).toBe(5);
    expect(stats.countries).toEqual([
      { label: 'Panama', mapId: 'PAN', bags: 2, rated: 2, rating: 4 },
      { label: 'Ethiopia', mapId: 'ETH', bags: 2, rated: 0, rating: null },
      { label: 'Atlantis', mapId: null, bags: 1, rated: 0, rating: null },
    ]);
    expect(stats.unmatched).toEqual(['Atlantis']);
    expect(stats.regions.map((r) => [r.country, r.label])).toContainEqual(['Panama', 'Boquete, Chiriquí']);
    expect(stats.roasters.map((r) => [r.label, r.bags])).toEqual([
      ['Tanat', 3],
      ['Nord Kaffe', 2],
    ]);
    expect(stats.varieties.find((v) => v.label === 'Geisha')).toEqual({
      label: 'Geisha',
      bags: 1,
      rated: 1,
      rating: 3.5,
    });
    expect(stats.roasts).toEqual([{ label: 'light', bags: 5, rated: 2, rating: 4 }]);
    expect(stats.altitudes).toEqual([{ label: '1600 to 1800 m', from: 1600, bags: 2, rated: 2, rating: 4 }]);
    expect(stats.noAltitude).toBe(3);
    expect(accountStats(db, 3)).toEqual(expect.objectContaining({ bags: 0, countries: [], spending: [] }));
  });

  test('add up spending by the month bought and currency, with the price per 100 g of the weighed bags', () => {
    const { db, bag } = withBags();
    const price = db.prepare('UPDATE bag SET price_cents = ?, currency = ?, bought_on = ?, weight_g = ? WHERE id = ?');
    price.run(1800, 'EUR', '2026-09-03', 250, bag(1, 'Elida'));
    price.run(2400, 'EUR', '2026-09-20', 200, bag(1, 'Audaura'));
    price.run(1500, 'EUR', '2026-10-01', null, bag(1, 'Sasaba'));
    price.run(2000, 'CHF', '2026-10-02', 250, bag(1, 'La Danta'));
    price.run(1000, 'EUR', null, 250, bag(1, 'Elto'));
    price.run(9900, 'EUR', '2026-09-03', 250, bag(2, 'Elida'));

    const stats = accountStats(db, 1);
    expect(stats.spending).toEqual([
      { month: '2026-09', currency: 'EUR', bags: 2, cents: 4200, per100g: 933 },
      { month: '2026-10', currency: 'CHF', bags: 1, cents: 2000, per100g: 800 },
      { month: '2026-10', currency: 'EUR', bags: 1, cents: 1500, per100g: null },
    ]);
    expect(stats.pricedUndated).toBe(1);
  });
});

describe('the world map', () => {
  test('projects, simplifies and names each country, and leaves out Antarctica', () => {
    const square = (lon: number, lat: number, size: number) => [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ];
    const feature = (id: string, name: string, coordinates: unknown, extra: Record<string, string> = {}) => ({
      properties: { ADM0_A3: id, NAME: name, ...extra },
      geometry: { type: 'Polygon' as const, coordinates: coordinates as [number, number][][] },
    });
    const map = buildWorldMap({
      features: [
        feature('ETH', 'Ethiopia', square(33, 3, 15), { FORMAL_EN: 'Federal Democratic Republic of Ethiopia' }),
        feature('ATA', 'Antarctica', square(-180, -90, 30)),
        feature('PAN', 'Panama', square(-83, 7, 5)),
      ],
    });
    expect(map.width).toBe(960);
    expect(map.countries.map((c) => [c.id, c.keys])).toEqual([
      ['ETH', ['ethiopia', 'federal democratic republic of ethiopia']],
      ['PAN', ['panama']],
    ]);
    expect(map.countries[0]?.d).toMatch(/^M[\d.]+ [\d.]+(l-?[\d.]+ -?[\d.]+){3}z$/);
  });

  test('the committed map has the countries, in the map’s bounds', () => {
    expect(worldMap.countries.length).toBeGreaterThan(170);
    expect(worldMap.countries.some((c) => c.id === 'ATA')).toBe(false);
    for (const country of worldMap.countries) {
      const start = /^M([\d.]+) ([\d.]+)/.exec(country.d);
      expect([country.id, Number(start?.[1]) <= worldMap.width, Number(start?.[2]) <= worldMap.height]).toEqual([
        country.id,
        true,
        true,
      ]);
    }
    expect(nameKey('  The Côte-d’Ivoire ')).toBe('cote d ivoire');
  });
});
