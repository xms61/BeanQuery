import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { exportBags } from '../bag/export.js';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { editCoffee, moveBag, useMine } from './edit.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Account 1 has the five real bags (pool coffees 1 to 5). Account 2 has none yet. */
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

const sasaba = () => structuredClone(fixture.bags[0].coffee);

describe('editCoffee', () => {
  test('changes a pool coffee for every account, logging one row per changed field', () => {
    const db = seeded();
    addBag(db, 2, structuredClone(fixture.bags[0]));
    const facts = { ...sasaba(), region: 'Guji, Uraga', altitude: { printed: '2100m', min_m: 2100, max_m: 2100 } };

    expect(editCoffee(db, 2, 1, facts)).toEqual({
      status: 'saved',
      changed: ['region', 'altitude_printed', 'altitude_min_m', 'altitude_max_m'],
    });
    expect(exportBags(db, 1).bags[0]?.coffee).toMatchObject({ region: 'Guji, Uraga', altitude: facts.altitude });
    expect(db.prepare('SELECT account_id, field, old_value, new_value FROM coffee_edit ORDER BY id').all()).toEqual([
      { account_id: 2, field: 'region', old_value: 'Guji', new_value: 'Guji, Uraga' },
      { account_id: 2, field: 'altitude_printed', old_value: null, new_value: '2100m' },
      { account_id: 2, field: 'altitude_min_m', old_value: null, new_value: '2100' },
      { account_id: 2, field: 'altitude_max_m', old_value: null, new_value: '2100' },
    ]);
    db.close();
  });

  test('logs list changes as JSON, and a rename with its new name key', () => {
    const db = seeded();
    const facts = { ...sasaba(), name: 'Ethiopia Sasaba Washed Lot', tasting_notes: ['Peach', 'Jasmine'] };

    expect(editCoffee(db, 1, 1, facts)).toMatchObject({ status: 'saved', changed: ['name', 'tasting_notes'] });
    expect(db.prepare('SELECT name, name_key FROM coffee WHERE id = 1').get()).toEqual({
      name: 'Ethiopia Sasaba Washed Lot',
      name_key: 'ethiopia sasaba washed lot',
    });
    expect(db.prepare("SELECT old_value, new_value FROM coffee_edit WHERE field = 'tasting_notes'").get()).toEqual({
      old_value: '["Pineapple","Bergamot","Peach"]',
      new_value: '["Peach","Jasmine"]',
    });
    db.close();
  });

  test('an account with no bag on a pool coffee cannot edit it', () => {
    const db = seeded();
    expect(editCoffee(db, 2, 1, { ...sasaba(), region: 'Vandal' })).toEqual({ status: 'not_allowed' });
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Guji' });
    db.close();
  });

  test("another account's private coffee answers as if it didn't exist", () => {
    const db = seeded();
    const secret = structuredClone(fixture.bags[0]);
    secret.personal = { private: true };
    addBag(db, 2, secret);

    expect(editCoffee(db, 1, 6, { ...sasaba(), region: 'Peek' })).toEqual({ status: 'not_found' });
    expect(editCoffee(db, 1, 999, sasaba())).toEqual({ status: 'not_found' });
    db.close();
  });

  test('edits an own private coffee in place, without the pool edit log', () => {
    const db = seeded();
    const secret = structuredClone(fixture.bags[0]);
    secret.personal = { private: true };
    addBag(db, 2, secret);

    expect(editCoffee(db, 2, 6, { ...sasaba(), farm: 'Secret Farm' })).toMatchObject({ status: 'saved' });
    expect(db.prepare('SELECT farm FROM coffee WHERE id = 6').get()).toEqual({ farm: 'Secret Farm' });
    expect(db.prepare('SELECT count(*) AS n FROM coffee_edit').get()).toEqual({ n: 0 });
    db.close();
  });

  test('refuses a rename onto another pool coffee of the same roaster, and offers to move the bag there', () => {
    const db = seeded();
    const facts = { ...sasaba(), name: 'PERU LA DANTA' };

    expect(editCoffee(db, 1, 1, facts)).toEqual({ status: 'name_taken', coffeeId: 2 });
    expect(db.prepare('SELECT name FROM coffee WHERE id = 1').get()).toEqual({ name: 'Ethiopia Sasaba' });

    expect(moveBag(db, 1, 1, 2)).toBe(true);
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id = 1').get()).toEqual({ coffee_id: 2 });
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE id = 1').get()).toEqual({ n: 1 });
    db.close();
  });

  test('checks the facts by the contract, naming the field', () => {
    const db = seeded();
    expect(editCoffee(db, 1, 1, { ...sasaba(), varieties: Array(21).fill('SL28') })).toEqual({
      status: 'invalid',
      errors: [{ path: 'varieties', message: expect.stringMatching(/20/) }],
    });
    db.close();
  });
});

describe('moveBag', () => {
  test("can't move a bag onto another account's private coffee or another account's bag at all", () => {
    const db = seeded();
    const secret = structuredClone(fixture.bags[1]);
    secret.personal = { private: true };
    addBag(db, 2, secret);

    expect(moveBag(db, 1, 1, 6)).toBe(false);
    expect(moveBag(db, 2, 1, 2)).toBe(false);
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id = 1').get()).toEqual({ coffee_id: 1 });
    db.close();
  });
});

describe('moveBag, and privacy', () => {
  test('never moves a private bag onto a pool coffee, or a published bag onto a private coffee', () => {
    const db = seeded();
    const secret = structuredClone(fixture.bags[0]);
    secret.coffee.name = 'Secret Lot';
    secret.harvest = '2026/27';
    secret.personal = { private: true };
    addBag(db, 1, secret);

    expect(moveBag(db, 1, 6, 1)).toBe(false);
    expect(moveBag(db, 1, 1, 6)).toBe(false);
    expect(db.prepare('SELECT id, coffee_id FROM bag WHERE id IN (1, 6) ORDER BY id').all()).toEqual([
      { id: 1, coffee_id: 1 },
      { id: 6, coffee_id: 6 },
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM coffee_harvest').get()).toEqual({ n: 0 });
    db.close();
  });

  test("never moves a bag onto another roaster's coffee", () => {
    const db = seeded();
    expect(moveBag(db, 1, 1, 3)).toBe(false);
    db.close();
  });
});

describe('useMine', () => {
  test('applies one differing value from a paste as a logged edit', () => {
    const db = seeded();
    addBag(db, 2, structuredClone(fixture.bags[0]));

    expect(useMine(db, 2, 1, 'region', 'Sidama')).toMatchObject({ status: 'saved', changed: ['region'] });
    expect(useMine(db, 2, 1, 'altitude_min_m', '1900')).toMatchObject({ status: 'invalid' });
    expect(useMine(db, 2, 1, 'tasting_notes', '["Peach"]')).toMatchObject({ status: 'saved' });
    expect(useMine(db, 2, 1, 'decaf', 'true')).toMatchObject({ status: 'saved', changed: ['decaf'] });
    expect(db.prepare('SELECT region, decaf FROM coffee WHERE id = 1').get()).toEqual({ region: 'Sidama', decaf: 1 });
    db.close();
  });

  test("answers not_found for another account's private coffee before checking anything, so its facts can't be probed", () => {
    const db = seeded();
    const secret = structuredClone(fixture.bags[2]);
    secret.personal = { private: true };
    addBag(db, 2, secret);

    for (const value of ['1650', '99999', 'Valid region']) {
      expect(useMine(db, 1, 6, 'altitude_min_m', value)).toEqual({ status: 'not_found' });
      expect(useMine(db, 1, 999, 'altitude_min_m', value)).toEqual({ status: 'not_found' });
    }
    expect(useMine(db, 2, 1, 'altitude_min_m', '99999')).toEqual({ status: 'not_allowed' });
    db.close();
  });

  test('refuses a field that is not a coffee fact', () => {
    const db = seeded();
    expect(() => useMine(db, 1, 1, 'owner_account_id', '2')).toThrow(/not a coffee fact/);
    db.close();
  });
});
