import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { exportBags } from './export.js';
import { importBags } from './import.js';
import { addBag, deleteBag, editBag, setBagState } from './manage.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

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

/** A bag typed in by hand: no plan, no water, the way a form without the LLM would send it. */
function typedBag() {
  return {
    ...structuredClone(fixture.bags[0]),
    plan: null,
    brew: { water: null, kettle_c: 94, grinder: 'Comandante C40', grind: '24 clicks' },
    personal: { state: 'open', rating: 3.5 },
  };
}

const bagCount = (db: DatabaseSync) => Number(db.prepare('SELECT count(*) AS n FROM bag').get()?.n);

describe('addBag', () => {
  test('saves a bag typed in by hand, marked manual, onto the matching pool coffee', () => {
    const db = seeded();

    expect(addBag(db, 2, typedBag())).toMatchObject({ status: 'saved', bagIds: [6] });
    expect(
      db.prepare('SELECT coffee_id, source, import_payload, state, rating, kettle_c FROM bag WHERE id = 6').get(),
    ).toEqual({
      coffee_id: 1,
      source: 'manual',
      import_payload: null,
      state: 'open',
      rating: 3.5,
      kettle_c: 94,
    });
    db.close();
  });

  test('checks a typed bag by the contract’s rules, naming each field', () => {
    const db = seeded();
    const bag = typedBag();
    bag.coffee.farm = 'x'.repeat(501);
    bag.weight.grams = -5;

    expect(addBag(db, 2, bag)).toEqual({
      status: 'invalid',
      errors: [
        { path: 'coffee.farm', message: expect.stringMatching(/500/) },
        { path: 'weight.grams', message: expect.any(String) },
      ],
    });
    expect(bagCount(db)).toBe(5);
    db.close();
  });

  test('asks about an unknown roaster like a paste does, and saves after the pick', () => {
    const db = seeded();
    const bag = typedBag();
    bag.roaster = { name: 'Nord Kaffe Roastery' };

    expect(addBag(db, 2, bag)).toMatchObject({ status: 'needs_roaster', bags: [{ index: 0, reason: 'unknown' }] });
    expect(addBag(db, 2, bag, { roasterChoice: 1 })).toMatchObject({ status: 'saved' });
    db.close();
  });
});

describe('editBag', () => {
  test("changes the bag's own fields, and leaves the coffee and the other bags alone", () => {
    const db = seeded();
    const fields = { ...structuredClone(fixture.bags[0]), lot: 'Lot 7', personal: { state: 'frozen', rating: 4 } };
    delete fields.roaster;
    delete fields.coffee;
    fields.brew.grind = '4.1';

    expect(editBag(db, 1, 1, fields)).toEqual({ status: 'saved' });
    const exported = exportBags(db, 1);
    expect(exported.bags[0]).toMatchObject({
      coffee: fixture.bags[0].coffee,
      lot: 'Lot 7',
      brew: { grind: '4.1' },
      personal: { state: 'frozen', rating: 4, private: false },
    });
    expect(exported.bags[1]).toMatchObject({ lot: null, brew: { grind: '4.2' } });
    db.close();
  });

  test("an edited harvest joins a pool coffee's harvest list, but never from a private bag", () => {
    const db = seeded();
    const secret = structuredClone(fixture.bags[0]);
    secret.coffee.name = 'Secret Lot';
    secret.personal = { private: true };
    addBag(db, 1, secret);

    const fields = structuredClone(fixture.bags[0]);
    delete fields.roaster;
    delete fields.coffee;
    editBag(db, 1, 1, { ...fields, harvest: '2026/27' });
    editBag(db, 1, 6, { ...fields, harvest: '2027/28' });

    expect(db.prepare('SELECT coffee_id, harvest FROM coffee_harvest').all()).toEqual([
      { coffee_id: 1, harvest: '2026/27' },
    ]);
    db.close();
  });

  test('a field left out of personal is cleared, because the form sends the whole bag', () => {
    const db = seeded();
    const fields = structuredClone(fixture.bags[0]);
    delete fields.roaster;
    delete fields.coffee;
    editBag(db, 1, 1, { ...fields, personal: { rating: 4, note: 'Good' } });
    editBag(db, 1, 1, { ...fields, personal: { rating: 4 } });

    expect(db.prepare('SELECT rating, note, state FROM bag WHERE id = 1').get()).toEqual({
      rating: 4,
      note: null,
      state: 'sealed',
    });
    db.close();
  });

  test('refuses coffee facts and the private flag, which change through their own steps', () => {
    const db = seeded();
    const withCoffee = structuredClone(fixture.bags[0]);
    delete withCoffee.roaster;
    expect(editBag(db, 1, 1, withCoffee)).toMatchObject({ status: 'invalid', errors: [{ path: '' }] });

    const fields = structuredClone(fixture.bags[0]);
    delete fields.roaster;
    delete fields.coffee;
    expect(editBag(db, 1, 1, { ...fields, personal: { private: true } })).toMatchObject({
      status: 'invalid',
      errors: [{ path: 'personal' }],
    });
    db.close();
  });

  test("can't edit another account's bag, and doesn't say whether it exists", () => {
    const db = seeded();
    const fields = structuredClone(fixture.bags[0]);
    delete fields.roaster;
    delete fields.coffee;

    expect(editBag(db, 2, 1, { ...fields, lot: 'Stolen' })).toEqual({ status: 'not_found' });
    expect(editBag(db, 2, 999, fields)).toEqual({ status: 'not_found' });
    expect(db.prepare('SELECT lot FROM bag WHERE id = 1').get()).toEqual({ lot: null });
    db.close();
  });
});

describe('setBagState', () => {
  test('sets the state of an own bag only', () => {
    const db = seeded();
    expect(setBagState(db, 1, 3, 'frozen')).toBe(true);
    expect(setBagState(db, 2, 4, 'finished')).toBe(false);
    expect(db.prepare('SELECT id, state FROM bag WHERE id IN (3, 4) ORDER BY id').all()).toEqual([
      { id: 3, state: 'frozen' },
      { id: 4, state: 'sealed' },
    ]);
    db.close();
  });

  test('refuses a state that is not sealed, open, frozen or finished', () => {
    const db = seeded();
    expect(() => setBagState(db, 1, 3, 'opened' as 'open')).toThrow(/sealed, open, frozen or finished/);
    db.close();
  });
});

describe('deleteBag', () => {
  test('deletes an own bag and leaves its pool coffee in place', () => {
    const db = seeded();
    expect(deleteBag(db, 1, 1)).toBe(true);
    expect(bagCount(db)).toBe(4);
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE id = 1').get()).toEqual({ n: 1 });
    db.close();
  });

  test("can't delete another account's bag", () => {
    const db = seeded();
    expect(deleteBag(db, 2, 1)).toBe(false);
    expect(bagCount(db)).toBe(5);
    db.close();
  });
});
