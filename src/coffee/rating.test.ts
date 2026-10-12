import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { addBag, editBag } from '../bag/manage.js';
import { repasteBag } from '../bag/repaste.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { rebuildCollectiveRatings } from './rating.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

function seeded(accounts = 12): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [{ slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] }]);
  const insert = db.prepare(
    "INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES (?, randomblob(32), '2026-10-12', '2026-10-12')",
  );
  for (let id = 1; id <= accounts; id++) insert.run(id);
  return db;
}

/** A Sasaba bag for an account; the first one creates pool coffee 1. */
const rate = (db: DatabaseSync, accountId: number, rating: number | null, personal: object = {}) => {
  const bag = structuredClone(fixture.bags[0]);
  bag.personal = { rating, ...personal };
  return addBag(db, accountId, bag);
};
const ratings = (db: DatabaseSync) =>
  db.prepare('SELECT coffee_id, rating_rounded, account_band FROM coffee_rating').all();

describe('rebuildCollectiveRatings', () => {
  test('hides a coffee rated by 2 accounts, and shows it at 3, rounded to half a bean with a count band', () => {
    const db = seeded();
    rate(db, 1, 4);
    rate(db, 2, 4.5);
    rebuildCollectiveRatings(db);
    expect(ratings(db)).toEqual([]);

    rate(db, 3, 3);
    rebuildCollectiveRatings(db);
    // The mean is 3.83, which rounds to 4.
    expect(ratings(db)).toEqual([{ coffee_id: 1, rating_rounded: 4, account_band: '3+' }]);
    db.close();
  });

  test('counts one rating per account: the latest rated bag, any harvest', () => {
    const db = seeded();
    rate(db, 1, 5);
    rate(db, 2, 5);
    rate(db, 3, 5);
    rate(db, 3, 1);
    rebuildCollectiveRatings(db);
    // Account 3's latest bag says 1: (5 + 5 + 1) / 3 = 3.67, which rounds to 3.5.
    expect(ratings(db)).toEqual([{ coffee_id: 1, rating_rounded: 3.5, account_band: '3+' }]);

    // Rating the older bag again makes it the latest.
    const fields = structuredClone(fixture.bags[0]);
    delete fields.roaster;
    delete fields.coffee;
    editBag(db, 3, 3, { ...fields, personal: { rating: 4 } });
    db.exec("UPDATE bag SET rated_on = '2026-10-01' WHERE id = 4");
    rebuildCollectiveRatings(db);
    expect(ratings(db)).toEqual([{ coffee_id: 1, rating_rounded: 4.5, account_band: '3+' }]);
    db.close();
  });

  test('ignores bags without a rating, and shows 10+ from ten accounts', () => {
    const db = seeded();
    for (let id = 1; id <= 10; id++) rate(db, id, 4);
    rate(db, 11, null);
    rebuildCollectiveRatings(db);
    expect(ratings(db)).toEqual([{ coffee_id: 1, rating_rounded: 4, account_band: '10+' }]);
    db.close();
  });

  test("a private bean's rating never counts, and saving it leaves the pool coffee and its rating unchanged", () => {
    const db = seeded();
    for (let id = 1; id <= 3; id++) rate(db, id, 4);
    rebuildCollectiveRatings(db);
    const pool = db.prepare('SELECT * FROM coffee WHERE id = 1').get();

    rate(db, 4, 0, { private: true });
    rebuildCollectiveRatings(db);
    expect(ratings(db)).toEqual([{ coffee_id: 1, rating_rounded: 4, account_band: '3+' }]);
    expect(db.prepare('SELECT * FROM coffee WHERE id = 1').get()).toEqual(pool);
    db.close();
  });

  test('rebuilds in full, so a deleted bag or account drops out', () => {
    const db = seeded();
    for (let id = 1; id <= 3; id++) rate(db, id, 4);
    rebuildCollectiveRatings(db);
    db.exec('DELETE FROM account WHERE id = 3');
    rebuildCollectiveRatings(db);
    expect(ratings(db)).toEqual([]);
    db.close();
  });

  test('a re-paste keeps the rating date when the rating stays, and moves it when the rating changes', () => {
    const db = seeded();
    rate(db, 1, 4);
    db.exec("UPDATE bag SET rated_on = '2026-10-01' WHERE id = 1");
    const one = (personal: object) => {
      const bag = structuredClone(fixture.bags[0]);
      bag.personal = personal;
      return JSON.stringify({ schema: 'beanquery.bags/v1', bags: [bag] });
    };

    repasteBag(db, 1, 1, one({ note: 'Rating left out, so it stays 4' }));
    expect(db.prepare('SELECT rating, rated_on FROM bag WHERE id = 1').get()).toEqual({
      rating: 4,
      rated_on: '2026-10-01',
    });
    repasteBag(db, 1, 1, one({ rating: 4.5 }));
    expect(db.prepare('SELECT rating, rated_on FROM bag WHERE id = 1').get()).toEqual({
      rating: 4.5,
      rated_on: new Date().toISOString().slice(0, 10),
    });
    db.close();
  });

  test('records when a rating was set, and keeps that date while the rating stays', () => {
    const db = seeded();
    rate(db, 1, 4);
    const today = new Date().toISOString().slice(0, 10);
    expect(db.prepare('SELECT rated_on FROM bag WHERE id = 1').get()).toEqual({ rated_on: today });

    db.exec("UPDATE bag SET rated_on = '2026-10-01' WHERE id = 1");
    const fields = structuredClone(fixture.bags[0]);
    delete fields.roaster;
    delete fields.coffee;
    editBag(db, 1, 1, { ...fields, personal: { rating: 4, note: 'Same rating, new note' } });
    expect(db.prepare('SELECT rated_on FROM bag WHERE id = 1').get()).toEqual({ rated_on: '2026-10-01' });
    editBag(db, 1, 1, { ...fields, personal: {} });
    expect(db.prepare('SELECT rated_on FROM bag WHERE id = 1').get()).toEqual({ rated_on: null });
    db.close();
  });
});
