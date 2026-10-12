import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { useMine } from '../coffee/edit.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { importBags } from './import.js';
import { addBag, editBag } from './manage.js';
import { repasteBag } from './repaste.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Account 1 has the five real bags on pool coffees 1 to 5; account 2 has bag 6 on pool coffee 1. */
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
  addBag(db, 2, structuredClone(fixture.bags[0]));
  return db;
}

const one = (bag: unknown) => JSON.stringify({ schema: 'beanquery.bags/v1', bags: [bag] });
const sasabaBag = () => structuredClone(fixture.bags[0]);

describe('repasteBag', () => {
  test("leaves a pool coffee's values unchanged until the user picks Use mine", () => {
    const db = seeded();
    const bag = sasabaBag();
    bag.coffee.region = 'Sidama';
    bag.coffee.farm = 'Sasaba Station';

    expect(repasteBag(db, 2, 6, one(bag))).toEqual({
      status: 'saved',
      differences: [{ index: 0, field: 'region', pool: 'Guji', yours: 'Sidama' }],
    });
    expect(db.prepare('SELECT region, farm FROM coffee WHERE id = 1').get()).toEqual({
      region: 'Guji',
      farm: 'Sasaba Station',
    });

    useMine(db, 2, 1, 'region', 'Sidama');
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Sidama' });
    db.close();
  });

  test("replaces the bag's own fields the JSON carries, and keeps the personal fields it leaves out", () => {
    const db = seeded();
    const fields = sasabaBag();
    delete fields.roaster;
    delete fields.coffee;
    editBag(db, 2, 6, { ...fields, personal: { state: 'open', rating: 4.5, note: 'Lovely' } });

    const bag = sasabaBag();
    bag.brew.grind = '5.0';
    bag.personal = { rating: 3 };
    expect(repasteBag(db, 2, 6, one(bag))).toMatchObject({ status: 'saved' });
    expect(db.prepare('SELECT grind, state, rating, note FROM bag WHERE id = 6').get()).toEqual({
      grind: '5.0',
      state: 'open',
      rating: 3,
      note: 'Lovely',
    });
    db.close();
  });

  test('matches the coffee again, so a re-paste naming another coffee moves the bag to it', () => {
    const db = seeded();
    const bag = sasabaBag();
    bag.coffee = structuredClone(fixture.bags[1].coffee);

    expect(repasteBag(db, 2, 6, one(bag))).toMatchObject({ status: 'saved', differences: [] });
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id = 6').get()).toEqual({ coffee_id: 2 });
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE id = 1').get()).toEqual({ n: 1 });
    db.close();
  });

  test('edits an own private coffee in place', () => {
    const db = seeded();
    const secret = sasabaBag();
    secret.coffee.name = 'Secret Lot';
    secret.personal = { private: true };
    addBag(db, 2, secret);

    secret.coffee.region = 'Hidden Valley';
    expect(repasteBag(db, 2, 7, one(secret))).toEqual({ status: 'saved', differences: [] });
    expect(db.prepare('SELECT id, region, owner_account_id FROM coffee WHERE id = 6').get()).toEqual({
      id: 6,
      region: 'Hidden Valley',
      owner_account_id: 2,
    });
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id = 7').get()).toEqual({ coffee_id: 6 });
    expect(db.prepare('SELECT count(*) AS n FROM coffee_edit').get()).toEqual({ n: 0 });
    db.close();
  });

  test('refuses a rename of an own private coffee onto another of its private coffees', () => {
    const db = seeded();
    for (const name of ['Secret One', 'Secret Two']) {
      const secret = sasabaBag();
      secret.coffee.name = name;
      secret.personal = { private: true };
      addBag(db, 2, secret);
    }
    const renamed = sasabaBag();
    renamed.coffee.name = 'SECRET TWO';
    renamed.personal = { private: true };

    expect(repasteBag(db, 2, 7, one(renamed))).toEqual({ status: 'name_taken', coffeeId: 7 });
    expect(db.prepare('SELECT name FROM coffee WHERE id = 6').get()).toEqual({ name: 'Secret One' });
    db.close();
  });

  test('takes one bag at a time, and leaves making a bean private or public to its own step', () => {
    const db = seeded();
    expect(
      repasteBag(db, 2, 6, JSON.stringify({ schema: 'beanquery.bags/v1', bags: [sasabaBag(), sasabaBag()] })),
    ).toEqual({
      status: 'invalid',
      errors: [{ path: 'bags', message: expect.stringMatching(/one bag/) }],
    });

    const toPrivate = sasabaBag();
    toPrivate.personal = { private: true };
    expect(repasteBag(db, 2, 6, one(toPrivate))).toEqual({
      status: 'invalid',
      errors: [{ path: 'bags[0].personal.private', message: expect.stringMatching(/private/) }],
    });
    db.close();
  });

  test("answers not_found for another account's bag and changes nothing", () => {
    const db = seeded();
    const bag = sasabaBag();
    bag.brew.grind = '9.0';
    expect(repasteBag(db, 2, 1, one(bag))).toEqual({ status: 'not_found' });
    expect(db.prepare('SELECT grind FROM bag WHERE id = 1').get()).toEqual({ grind: '4.2' });
    db.close();
  });
});
