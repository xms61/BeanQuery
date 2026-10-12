import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { isCloseName } from './match.js';
import { rebuildCollectiveRatings } from './rating.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Account 1 has the five real bags on pool coffees 1 to 5 (1 and 2 by Nord Kaffe, 3 to 5 by Tanat). */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  importBags(db, 1, JSON.stringify(fixture), { limits: pasteLimits });
  return db;
}

const sasaba = (name: string, personal?: object) => {
  const bag = structuredClone(fixture.bags[0]);
  bag.coffee.name = name;
  if (personal) bag.personal = personal;
  return bag;
};
const paste = (db: DatabaseSync, accountId: number, bags: unknown[], coffeeChoices = {}) =>
  importBags(db, accountId, JSON.stringify({ schema: 'beanquery.bags/v1', bags }), {
    limits: pasteLimits,
    coffeeChoices,
  });
const count = (db: DatabaseSync, sql: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${sql}`).get()?.n);

describe('isCloseName', () => {
  test.each([
    ['gathaithi aa', 'gathaithi aa lot 2', true],
    ['ethiopia sasaba washed', 'ethiopia sasaba', true],
    ['sasaba 1', 'sasaba 2', false],
    ['ethiopia sasaba', 'ethiopia sasaba', false],
    ['peru la danta', 'ethiopia sasaba', false],
    ['panama elida catuai', 'panama audaura geisha', false],
  ])('%j and %j: %s', (a, b, close) => {
    expect(isCloseName(a, b)).toBe(close);
  });
});

describe('close matches on import', () => {
  test('asks before saving a coffee whose name is close to a pool coffee of the same roaster', () => {
    const db = seeded();
    expect(paste(db, 2, [sasaba('Ethiopia Sasaba Lot 2')])).toEqual({
      status: 'needs_coffee',
      bags: [
        {
          index: 0,
          entered: 'Ethiopia Sasaba Lot 2',
          candidates: [{ id: 1, name: 'Ethiopia Sasaba', private: false }],
        },
      ],
    });
    expect(count(db, 'bag WHERE account_id = 2')).toBe(0);
    db.close();
  });

  test('links to the picked coffee, filling its gaps like an exact match', () => {
    const db = seeded();
    const bag = sasaba('Ethiopia Sasaba Lot 2');
    bag.coffee.farm = 'Sasaba Station';

    expect(paste(db, 2, [bag], { 0: 1 })).toMatchObject({ status: 'saved', bagIds: [6] });
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id = 6').get()).toEqual({ coffee_id: 1 });
    expect(db.prepare('SELECT name, farm FROM coffee WHERE id = 1').get()).toEqual({
      name: 'Ethiopia Sasaba',
      farm: 'Sasaba Station',
    });
    db.close();
  });

  test('creates a new pool coffee when the user says it is a different coffee', () => {
    const db = seeded();
    expect(paste(db, 2, [sasaba('Ethiopia Sasaba Lot 2')], { 0: 'new' })).toMatchObject({ status: 'saved' });
    expect(db.prepare('SELECT name FROM coffee WHERE id = 6').get()).toEqual({ name: 'Ethiopia Sasaba Lot 2' });
    db.close();
  });

  test('two bags of one new coffee in a paste, both answered new, share the coffee', () => {
    const db = seeded();
    const first = sasaba('Ethiopia Sasaba Lot 2');
    const second = sasaba('Ethiopia Sasaba Lot 2');
    second.harvest = '2026/27';

    expect(paste(db, 2, [first, second], { 0: 'new', 1: 'new' })).toMatchObject({ status: 'saved', bagIds: [6, 7] });
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id IN (6, 7)').all()).toEqual([
      { coffee_id: 6 },
      { coffee_id: 6 },
    ]);
    db.close();
  });

  test('picking an own private coffee keeps the bag private: no pool harvest, no collective rating', () => {
    const db = seeded();
    addBag(db, 2, sasaba('Sasaba Microlot', { private: true }));
    const bag = sasaba('Sasaba Microlot Two', { rating: 5 });
    bag.harvest = '2026/27';

    expect(paste(db, 2, [bag], { 0: 6 })).toMatchObject({ status: 'saved', bagIds: [7] });
    expect(
      db.prepare('SELECT c.id, c.owner_account_id FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.id = 7').get(),
    ).toEqual({
      id: 6,
      owner_account_id: 2,
    });
    expect(count(db, "coffee_harvest WHERE harvest = '2026/27'")).toBe(0);
    for (const accountId of [1, 3, 4])
      db.exec(
        `INSERT OR IGNORE INTO account (id, key_hash, created_on, last_seen_on) VALUES (${accountId}, randomblob(32), '2026-10-12', '2026-10-12')`,
      );
    rebuildCollectiveRatings(db);
    expect(count(db, 'coffee_rating WHERE coffee_id = 6')).toBe(0);
    db.close();
  });

  test('a bag typed in by hand takes the same pick', () => {
    const db = seeded();
    expect(addBag(db, 2, sasaba('Ethiopia Sasaba Lot 2'))).toMatchObject({ status: 'needs_coffee' });
    expect(addBag(db, 2, sasaba('Ethiopia Sasaba Lot 2'), { coffeeChoice: 1 })).toMatchObject({ status: 'saved' });
    expect(db.prepare('SELECT coffee_id FROM bag WHERE account_id = 2').get()).toEqual({ coffee_id: 1 });
    db.close();
  });

  test('refuses a pick that was not offered', () => {
    const db = seeded();
    expect(() => paste(db, 2, [sasaba('Ethiopia Sasaba Lot 2')], { 0: 3 })).toThrow(/not one of the coffees offered/);
    expect(count(db, 'bag WHERE account_id = 2')).toBe(0);
    db.close();
  });

  test("offers the account's own private coffees, never another account's", () => {
    const db = seeded();
    addBag(db, 1, sasaba('Sasaba Reserve', { private: true }));
    addBag(db, 2, sasaba('Sasaba Microlot', { private: true }));

    // Account 1's private "Sasaba Reserve" is the only close name, and it is not account 2's to see: no question.
    expect(paste(db, 2, [sasaba('Sasaba Reserve Lot 2')])).toMatchObject({ status: 'saved' });
    expect(db.prepare("SELECT owner_account_id FROM coffee WHERE name = 'Sasaba Reserve Lot 2'").get()).toEqual({
      owner_account_id: null,
    });

    expect(paste(db, 2, [sasaba('Sasaba Microlot Two')])).toMatchObject({
      status: 'needs_coffee',
      bags: [{ candidates: [{ name: 'Sasaba Microlot', private: true }] }],
    });
    db.close();
  });

  test("never offers another roaster's coffee, and never asks for a private bean", () => {
    const db = seeded();
    const tanat = sasaba('Ethiopia Sasaba Lot 2');
    tanat.roaster = { name: 'Tanat' };
    expect(paste(db, 2, [tanat])).toMatchObject({ status: 'saved' });
    expect(paste(db, 2, [sasaba('Ethiopia Sasaba Lot 3', { private: true })])).toMatchObject({ status: 'saved' });
    db.close();
  });

  test('an exact match never asks, even when close names exist too', () => {
    const db = seeded();
    paste(db, 2, [sasaba('Ethiopia Sasaba Lot 2')], { 0: 'new' });
    expect(paste(db, 2, [sasaba('ETHIOPIA SASABA')])).toMatchObject({ status: 'saved' });
    db.close();
  });
});
