import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { exportLimits, pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { importBags } from './import.js';

const fixture = readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8');

/** A migrated database with the fixture's two roasters, one ambiguous name, and two accounts. */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
    { slug: 'rose-oslo', name: 'Rose', otherNames: [] },
    { slug: 'rose-berlin', name: 'Rose', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  return db;
}

// The tests change the fixture on purpose, so it is reached into loosely rather than through the contract's types.
// biome-ignore lint/suspicious/noExplicitAny: deliberately untyped test data
type LooseDocument = Record<string, any>;

/** The fixture as an object, to change before pasting. */
function document(): LooseDocument {
  return JSON.parse(fixture);
}

const paste = (db: DatabaseSync, accountId: number, doc: unknown, roasterChoices = {}) =>
  importBags(db, accountId, typeof doc === 'string' ? doc : JSON.stringify(doc), {
    limits: pasteLimits,
    roasterChoices,
  });

const count = (db: DatabaseSync, sql: string, ...params: (string | number)[]) =>
  Number(db.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...params)?.n);

describe('importBags', () => {
  test('saves the five real bags, with their coffees in the pool and their plans, water and grind', () => {
    const db = seeded();
    const result = paste(db, 1, fixture);

    expect(result).toMatchObject({ status: 'saved', bagIds: [1, 2, 3, 4, 5], differences: [] });
    expect(count(db, 'bag WHERE account_id = 1')).toBe(5);
    expect(count(db, 'coffee WHERE owner_account_id IS NULL')).toBe(5);
    expect(
      db
        .prepare(
          `SELECT r.slug, c.name, c.name_key, c.process_category, c.altitude_min_m, b.roast_date, b.weight_g,
             b.weight_assumed, b.portion_from, b.portion_to, b.mid_peak, b.tube_count, b.water_kh, b.water_alt_kh,
             b.grind, b.state, b.source
           FROM bag b JOIN coffee c ON c.id = b.coffee_id JOIN roaster r ON r.id = c.roaster_id WHERE b.id = 3`,
        )
        .get(),
    ).toEqual({
      slug: 'tanat-coffee',
      name: 'Panama - Elida [Catuai ASD T4D 1304]',
      name_key: 'panama elida catuai asd t4d 1304',
      process_category: 'anaerobic',
      altitude_min_m: 1600,
      roast_date: '2026-09-18',
      weight_g: 250,
      weight_assumed: 1,
      portion_from: 25,
      portion_to: 28,
      mid_peak: 42,
      tube_count: 16,
      water_kh: 35,
      water_alt_kh: 20,
      grind: '4.2',
      state: 'sealed',
      source: 'json',
    });
    expect(db.prepare('SELECT name FROM coffee_variety WHERE coffee_id = 2 ORDER BY position').all()).toEqual([
      { name: 'Caturra' },
      { name: 'Bourbon' },
      { name: 'Catimor' },
      { name: 'Pache' },
    ]);
    expect(db.prepare('SELECT DISTINCT grinder_id FROM bag').all()).toEqual([{ grinder_id: 1 }]);
    expect(db.prepare('SELECT account_id, name FROM grinder').all()).toEqual([
      { account_id: 1, name: 'Fellow Ode Gen 2' },
    ]);
    db.close();
  });

  test('keeps the raw pasted bag for audit', () => {
    const db = seeded();
    paste(db, 1, fixture);
    const payload = db.prepare('SELECT import_payload FROM bag WHERE id = 1').get()?.import_payload;
    expect(JSON.parse(String(payload)).coffee.name).toBe('Ethiopia Sasaba');
    db.close();
  });

  test('returns the contract errors and saves nothing for an invalid paste', () => {
    const db = seeded();
    const doc = document();
    doc.bags[1].weight.grams = 0;

    expect(paste(db, 1, doc)).toEqual({
      status: 'invalid',
      errors: [{ path: 'bags[1].weight.grams', message: expect.any(String) }],
    });
    expect(count(db, 'bag')).toBe(0);
    db.close();
  });

  describe('roasters', () => {
    test('resolves by slug first, whatever the name says', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.bags[0].roaster = { name: 'Some other spelling', slug: 'nord-kaffe' };

      expect(paste(db, 1, doc)).toMatchObject({ status: 'saved' });
      db.close();
    });

    test('saves nothing while a roaster is unknown, and suggests similar names', () => {
      const db = seeded();
      const doc = document();
      doc.bags[2].roaster.name = 'Tanat Coffee Roasters';

      expect(paste(db, 1, doc)).toEqual({
        status: 'needs_roaster',
        bags: [
          {
            index: 2,
            entered: 'Tanat Coffee Roasters',
            reason: 'unknown',
            candidates: [{ id: 2, name: 'Tanat', slug: 'tanat-coffee', source: 'every_coffee' }],
          },
        ],
      });
      expect(count(db, 'bag') + count(db, 'coffee') + count(db, 'grinder')).toBe(0);
      db.close();
    });

    test('says when nothing is close, so the user can ask the admin to add the roaster', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.bags[0].roaster.name = 'Völlig Unbekannt';

      expect(paste(db, 1, doc)).toMatchObject({
        status: 'needs_roaster',
        bags: [{ index: 0, reason: 'unknown', candidates: [] }],
      });
      db.close();
    });

    test('asks the user to pick when two roasters share the name', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.bags[0].roaster.name = 'ROSE';

      expect(paste(db, 1, doc)).toMatchObject({
        status: 'needs_roaster',
        bags: [{ index: 0, reason: 'ambiguous', candidates: [{ slug: 'rose-oslo' }, { slug: 'rose-berlin' }] }],
      });
      expect(paste(db, 1, doc, { 0: 4 })).toMatchObject({ status: 'saved' });
      expect(db.prepare('SELECT roaster_id FROM coffee').get()).toEqual({ roaster_id: 4 });
      db.close();
    });

    test('a confirmed suggestion stores the pasted spelling as an alias, so the next paste resolves it', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[2]];
      doc.bags[0].roaster.name = 'Tanat Coffee Roasters';

      expect(paste(db, 1, doc, { 0: 2 })).toMatchObject({ status: 'saved' });
      doc.bags[0].coffee.name = 'Another Coffee';
      expect(paste(db, 2, doc)).toMatchObject({ status: 'saved' });
      db.close();
    });

    test('asks again for a choice that was not offered, and stores no alias, so no account can redirect a name for everyone', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[2]];
      doc.bags[0].roaster.name = 'Tanat Coffee Roasters';

      // A stale answer (the JSON changed after it) or a forged one: the question comes back.
      expect(paste(db, 1, doc, { 0: 1 })).toMatchObject({ status: 'needs_roaster', bags: [{ index: 0 }] });
      expect(count(db, 'roaster_alias') + count(db, 'bag')).toBe(0);
      db.close();
    });

    test('ignores a choice for a bag whose roaster resolves on its own', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];

      expect(paste(db, 1, doc, { 0: 2 })).toMatchObject({ status: 'saved' });
      expect(db.prepare('SELECT roaster_id FROM coffee').get()).toEqual({ roaster_id: 1 });
      expect(count(db, 'roaster_alias')).toBe(0);
      db.close();
    });

    test('a pick between roasters that share a name stores no alias', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.bags[0].roaster.name = 'ROSE';

      paste(db, 1, doc, { 0: 4 });
      expect(count(db, 'roaster_alias')).toBe(0);
      db.close();
    });

    test('asks again for a roaster choice that is not a registered roaster', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.bags[0].roaster.name = 'ROSE';

      expect(paste(db, 1, doc, { 0: 99 })).toMatchObject({ status: 'needs_roaster', bags: [{ reason: 'ambiguous' }] });
      expect(count(db, 'bag')).toBe(0);
      db.close();
    });
  });

  describe('the pool', () => {
    test('two accounts with the same coffee share one pool coffee, and each harvest is listed once', () => {
      const db = seeded();
      const first = document();
      first.bags = [first.bags[0]];
      first.bags[0].harvest = '2025/26';
      const second = structuredClone(first);
      second.bags[0].coffee.name = 'ETHIOPIA  SASABA [Natural]';
      second.bags[0].harvest = '2026/27';

      paste(db, 1, first);
      paste(db, 2, second);
      paste(db, 2, second);

      expect(count(db, 'coffee')).toBe(1);
      expect(db.prepare('SELECT harvest FROM coffee_harvest ORDER BY harvest').all()).toEqual([
        { harvest: '2025/26' },
        { harvest: '2026/27' },
      ]);
      expect(db.prepare('SELECT account_id, coffee_id FROM bag ORDER BY id').all()).toEqual([
        { account_id: 1, coffee_id: 1 },
        { account_id: 2, coffee_id: 1 },
        { account_id: 2, coffee_id: 1 },
      ]);
      db.close();
    });

    test('fills the pool coffee’s gaps, logs each fill, and reports the values that differ without changing them', () => {
      const db = seeded();
      const first = document();
      first.bags = [first.bags[0]];
      paste(db, 1, first);

      const second = structuredClone(first);
      second.bags[0].coffee.altitude = { printed: '1900-2100m', min_m: 1900, max_m: 2100 };
      second.bags[0].coffee.farm = 'Sasaba Station';
      second.bags[0].coffee.region = 'Sidama';
      second.bags[0].coffee.tasting_notes = ['Peach'];

      expect(paste(db, 2, second)).toMatchObject({
        status: 'saved',
        differences: [
          { index: 0, field: 'region', pool: 'Guji', yours: 'Sidama' },
          { index: 0, field: 'tasting_notes', pool: '["Pineapple","Bergamot","Peach"]', yours: '["Peach"]' },
        ],
      });
      expect(db.prepare('SELECT region, farm, altitude_printed, altitude_min_m FROM coffee').get()).toEqual({
        region: 'Guji',
        farm: 'Sasaba Station',
        altitude_printed: '1900-2100m',
        altitude_min_m: 1900,
      });
      expect(db.prepare('SELECT account_id, field, old_value, new_value FROM coffee_edit ORDER BY id').all()).toEqual([
        { account_id: 2, field: 'farm', old_value: null, new_value: 'Sasaba Station' },
        { account_id: 2, field: 'altitude_printed', old_value: null, new_value: '1900-2100m' },
        { account_id: 2, field: 'altitude_min_m', old_value: null, new_value: '1900' },
        { account_id: 2, field: 'altitude_max_m', old_value: null, new_value: '2100' },
      ]);
      db.close();
    });

    test('a private bean never touches the pool, even when a pool coffee has its name', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.bags[0].harvest = '2025/26';
      paste(db, 1, doc);

      const secret = structuredClone(doc);
      secret.bags[0].harvest = '2026/27';
      secret.bags[0].coffee.farm = 'Secret Farm';
      secret.bags[0].personal = { private: true };
      expect(paste(db, 2, secret)).toMatchObject({ status: 'saved', differences: [] });
      expect(paste(db, 2, secret)).toMatchObject({ status: 'saved' });

      expect(db.prepare('SELECT id, owner_account_id, farm FROM coffee ORDER BY id').all()).toEqual([
        { id: 1, owner_account_id: null, farm: null },
        { id: 2, owner_account_id: 2, farm: 'Secret Farm' },
      ]);
      expect(db.prepare('SELECT coffee_id, harvest FROM coffee_harvest').all()).toEqual([
        { coffee_id: 1, harvest: '2025/26' },
      ]);
      expect(count(db, 'coffee_edit')).toBe(0);
      db.close();
    });
  });

  describe('personal data', () => {
    test('saves the personal block, with sealed and published as defaults', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0], doc.bags[1]];
      doc.bags[1].personal = {
        state: 'open',
        rating: 4.5,
        rebuy: true,
        note: 'Juicy',
        bought_on: '2026-09-20',
        price: { cents: 1650, currency: 'NOK' },
        shop: 'nordkaffe.no',
      };
      paste(db, 1, doc);

      expect(
        db
          .prepare('SELECT state, rating, rebuy, note, bought_on, price_cents, currency, shop FROM bag ORDER BY id')
          .all(),
      ).toEqual([
        {
          state: 'sealed',
          rating: null,
          rebuy: null,
          note: null,
          bought_on: null,
          price_cents: null,
          currency: null,
          shop: null,
        },
        {
          state: 'open',
          rating: 4.5,
          rebuy: 1,
          note: 'Juicy',
          bought_on: '2026-09-20',
          price_cents: 1650,
          currency: 'NOK',
          shop: 'nordkaffe.no',
        },
      ]);
      db.close();
    });

    test('matches grinders by name, ignoring case, and keeps each account’s grinders apart', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0], doc.bags[1]];
      doc.bags[1].brew.grinder = 'fellow ode gen 2 ';
      doc.grinders = [{ name: 'Fellow Ode Gen 2', note: 'Stock burrs' }];
      paste(db, 1, doc);
      paste(db, 2, doc);

      expect(db.prepare('SELECT id, account_id, name, note FROM grinder ORDER BY id').all()).toEqual([
        { id: 1, account_id: 1, name: 'Fellow Ode Gen 2', note: 'Stock burrs' },
        { id: 2, account_id: 2, name: 'Fellow Ode Gen 2', note: 'Stock burrs' },
      ]);
      expect(db.prepare('SELECT account_id, grinder_id FROM bag ORDER BY id').all()).toEqual([
        { account_id: 1, grinder_id: 1 },
        { account_id: 1, grinder_id: 1 },
        { account_id: 2, grinder_id: 2 },
        { account_id: 2, grinder_id: 2 },
      ]);
      db.close();
    });

    test('saves roaster notes, and refuses two notes on one roaster', () => {
      const db = seeded();
      const doc = document();
      doc.bags = [doc.bags[0]];
      doc.roaster_notes = [{ roaster: { name: 'Nord Kaffe', slug: 'nord-kaffe' }, note: 'Ships fast' }];
      paste(db, 1, doc);
      expect(db.prepare('SELECT account_id, roaster_id, note FROM roaster_note').all()).toEqual([
        { account_id: 1, roaster_id: 1, note: 'Ships fast' },
      ]);

      doc.roaster_notes = [
        { roaster: { name: 'Nord Kaffe' }, note: 'One' },
        { roaster: { name: 'NORD KAFFE' }, note: 'Two' },
      ];
      expect(paste(db, 2, doc)).toEqual({
        status: 'invalid',
        errors: [{ path: 'roaster_notes[1]', message: expect.stringMatching(/same roaster as roaster_notes\[0\]/) }],
      });
      expect(count(db, 'bag WHERE account_id = 2')).toBe(0);
      db.close();
    });

    test('an export file can hold more bags than a paste', () => {
      const db = seeded();
      const doc = document();
      doc.bags = Array.from({ length: 60 }, (_, i) => ({ ...doc.bags[0], lot: `Lot ${i}` }));

      expect(paste(db, 1, doc)).toMatchObject({ status: 'invalid' });
      expect(importBags(db, 1, JSON.stringify(doc), { limits: exportLimits })).toMatchObject({ status: 'saved' });
      expect(count(db, 'bag')).toBe(60);
      db.close();
    });
  });
});

describe('previewing an import', () => {
  test('says what saving would do, and saves nothing', () => {
    const db = seeded();
    // Account 2 already put Ethiopia Sasaba in the pool, with a different region.
    const first = document();
    first.bags = [first.bags[0]];
    first.bags[0].coffee.region = 'Sidama';
    paste(db, 2, first);
    const before = count(db, 'bag') + count(db, 'coffee') + count(db, 'coffee_edit') + count(db, 'roaster_alias');

    const doc = document();
    doc.bags = [doc.bags[0], doc.bags[2]];
    doc.bags[1].personal = { private: true };
    const result = importBags(db, 1, JSON.stringify(doc), { limits: pasteLimits, preview: true });

    expect(result).toEqual({
      status: 'preview',
      bags: [
        { roaster: 'Nord Kaffe', roasterMatch: 'name', coffee: 'joins_pool' },
        { roaster: 'Tanat', roasterMatch: 'name', coffee: 'new_private' },
      ],
      differences: [{ index: 0, field: 'region', pool: 'Sidama', yours: 'Guji' }],
    });
    expect(count(db, 'bag') + count(db, 'coffee') + count(db, 'coffee_edit') + count(db, 'roaster_alias')).toBe(before);
    db.close();
  });

  test('marks a roaster the user picked, and a coffee that would be new in the pool', () => {
    const db = seeded();
    const doc = document();
    doc.bags = [doc.bags[0]];
    doc.bags[0].roaster = { name: 'Rose' };
    const rose = Number(db.prepare("SELECT id FROM roaster WHERE slug = 'rose-oslo'").get()?.id);
    const result = importBags(db, 1, JSON.stringify(doc), {
      limits: pasteLimits,
      preview: true,
      roasterChoices: { 0: rose },
    });
    expect(result).toMatchObject({
      status: 'preview',
      bags: [{ roaster: 'Rose', roasterMatch: 'picked', coffee: 'new_pool' }],
    });
    expect(count(db, 'bag')).toBe(0);
    db.close();
  });
});
