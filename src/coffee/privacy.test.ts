import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { exportBags } from '../bag/export.js';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { repasteBag } from '../bag/repaste.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { makeBeanPrivate, publishBean } from './privacy.js';
import { rebuildCollectiveRatings } from './rating.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Account 1 has the five real bags on pool coffees 1 to 5. Accounts 2 to 4 have none yet. */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  const insert = db.prepare(
    "INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES (?, randomblob(32), '2026-10-12', '2026-10-12')",
  );
  for (let id = 1; id <= 4; id++) insert.run(id);
  importBags(db, 1, JSON.stringify(fixture), { limits: pasteLimits });
  return db;
}

const sasaba = (personal: object = {}, name = 'Ethiopia Sasaba', harvest: string | null = null) => {
  const bag = structuredClone(fixture.bags[0]);
  bag.coffee.name = name;
  bag.harvest = harvest;
  bag.personal = personal;
  return bag;
};
const bagIdOf = (result: { status: string; bagIds?: number[] }) => {
  if (result.status !== 'saved' || !result.bagIds?.[0]) throw new Error(`not saved: ${JSON.stringify(result)}`);
  return result.bagIds[0];
};
const coffeeOf = (db: DatabaseSync, bagId: number) =>
  db
    .prepare('SELECT c.id, c.owner_account_id AS owner FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.id = ?')
    .get(bagId);
const ratingOf = (db: DatabaseSync, coffeeId: number) =>
  db.prepare('SELECT rating_rounded, account_band FROM coffee_rating WHERE coffee_id = ?').get(coffeeId) ?? null;

describe('makeBeanPrivate', () => {
  test("moves all the account's bags on the pool coffee to a new private copy, and leaves the pool coffee for others", () => {
    const db = seeded();
    const a = bagIdOf(addBag(db, 2, sasaba({ rating: 4 }, 'Ethiopia Sasaba', '2025/26')));
    const b = bagIdOf(addBag(db, 2, sasaba({ rating: 4.5 })));

    expect(makeBeanPrivate(db, 2, a)).toEqual({ status: 'saved', coffeeId: 6, movedBags: 2 });
    expect(coffeeOf(db, a)).toEqual({ id: 6, owner: 2 });
    expect(coffeeOf(db, b)).toEqual({ id: 6, owner: 2 });
    expect(coffeeOf(db, 1)).toEqual({ id: 1, owner: null });
    expect(exportBags(db, 2).bags[0]).toMatchObject({ coffee: fixture.bags[0].coffee, personal: { private: true } });
    db.close();
  });

  test('moves the bags into an existing private coffee of the same roaster and name instead of making a copy', () => {
    const db = seeded();
    const published = bagIdOf(addBag(db, 2, sasaba()));
    const secret = bagIdOf(addBag(db, 2, sasaba({ private: true })));
    const privateId = coffeeOf(db, secret)?.id;

    expect(makeBeanPrivate(db, 2, published)).toEqual({ status: 'saved', coffeeId: privateId, movedBags: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE owner_account_id = 2').get()).toEqual({ n: 1 });
    db.close();
  });

  test("takes the account's rating out of the collective rating at the next rebuild", () => {
    const db = seeded();
    for (const accountId of [2, 3, 4]) addBag(db, accountId, sasaba({ rating: 4 }));
    rebuildCollectiveRatings(db);
    expect(ratingOf(db, 1)).toEqual({ rating_rounded: 4, account_band: '3+' });

    makeBeanPrivate(db, 4, 8);
    rebuildCollectiveRatings(db);
    expect(ratingOf(db, 1)).toBeNull();
    db.close();
  });

  test("answers not_found for another account's bag, and already_private for a private one", () => {
    const db = seeded();
    const secret = bagIdOf(addBag(db, 2, sasaba({ private: true })));
    expect(makeBeanPrivate(db, 2, 1)).toEqual({ status: 'not_found' });
    expect(makeBeanPrivate(db, 2, secret)).toEqual({ status: 'already_private' });
    db.close();
  });
});

describe('publishBean', () => {
  test('on an exact match, moves the bags to the pool coffee, fills its gaps, lists the harvests, and deletes the private coffee', () => {
    const db = seeded();
    const secret = sasaba({ private: true, rating: 4 }, 'ETHIOPIA SASABA', '2026/27');
    secret.coffee.farm = 'Sasaba Station';
    const bagId = bagIdOf(addBag(db, 2, secret));
    const privateId = Number(coffeeOf(db, bagId)?.id);

    expect(publishBean(db, 2, bagId)).toEqual({ status: 'saved', coffeeId: 1, movedBags: 1, differences: [] });
    expect(coffeeOf(db, bagId)).toEqual({ id: 1, owner: null });
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE id = ?').get(privateId)).toEqual({ n: 0 });
    expect(db.prepare('SELECT farm FROM coffee WHERE id = 1').get()).toEqual({ farm: 'Sasaba Station' });
    expect(db.prepare('SELECT harvest FROM coffee_harvest WHERE coffee_id = 1').all()).toEqual([
      { harvest: '2026/27' },
    ]);
    db.close();
  });

  test('without a match, the private coffee itself becomes the pool coffee, and its rating counts', () => {
    const db = seeded();
    const ids = [2, 3, 4].map((accountId) =>
      bagIdOf(addBag(db, accountId, sasaba({ private: accountId === 2, rating: 5 }, 'Halo Hartume', '2025/26'))),
    );
    const privateId = Number(coffeeOf(db, ids[0] as number)?.id);
    // Accounts 3 and 4 published "Halo Hartume" too, so it is in the pool; account 2 kept a private one.
    rebuildCollectiveRatings(db);
    expect(ratingOf(db, Number(coffeeOf(db, ids[1] as number)?.id))).toBeNull();

    const lone = bagIdOf(addBag(db, 2, sasaba({ private: true }, 'Only Mine', '2024/25')));
    const loneCoffee = Number(coffeeOf(db, lone)?.id);
    expect(publishBean(db, 2, lone)).toMatchObject({ status: 'saved', coffeeId: loneCoffee, movedBags: 1 });
    expect(coffeeOf(db, lone)).toEqual({ id: loneCoffee, owner: null });
    expect(db.prepare('SELECT harvest FROM coffee_harvest WHERE coffee_id = ?').all(loneCoffee)).toEqual([
      { harvest: '2024/25' },
    ]);

    expect(publishBean(db, 2, ids[0] as number)).toMatchObject({ status: 'saved', movedBags: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE id = ?').get(privateId)).toEqual({ n: 0 });
    rebuildCollectiveRatings(db);
    expect(ratingOf(db, Number(coffeeOf(db, ids[0] as number)?.id))).toEqual({ rating_rounded: 5, account_band: '3+' });
    db.close();
  });

  test('asks about a close pool coffee first, then follows the pick', () => {
    const db = seeded();
    const bagId = bagIdOf(addBag(db, 2, sasaba({ private: true }, 'Ethiopia Sasaba Lot 2')));
    expect(publishBean(db, 2, bagId)).toEqual({
      status: 'needs_coffee',
      bags: [
        {
          index: 0,
          entered: 'Ethiopia Sasaba Lot 2',
          candidates: [{ id: 1, name: 'Ethiopia Sasaba', private: false }],
        },
      ],
    });
    expect(coffeeOf(db, bagId)?.owner).toBe(2);

    expect(publishBean(db, 2, bagId, { coffeeChoice: 1 })).toMatchObject({ status: 'saved', coffeeId: 1 });
    expect(coffeeOf(db, bagId)).toEqual({ id: 1, owner: null });
    db.close();
  });

  test('a pick of new publishes the private coffee as it is', () => {
    const db = seeded();
    const bagId = bagIdOf(addBag(db, 2, sasaba({ private: true }, 'Ethiopia Sasaba Lot 2')));
    const coffeeId = Number(coffeeOf(db, bagId)?.id);
    expect(publishBean(db, 2, bagId, { coffeeChoice: 'new' })).toMatchObject({ status: 'saved', coffeeId });
    expect(coffeeOf(db, bagId)).toEqual({ id: coffeeId, owner: null });
    db.close();
  });

  test("answers not_found for another account's bag, and already_published for a pool one", () => {
    const db = seeded();
    const secret = bagIdOf(addBag(db, 2, sasaba({ private: true })));
    expect(publishBean(db, 1, secret)).toEqual({ status: 'not_found' });
    expect(publishBean(db, 1, 1)).toEqual({ status: 'already_published' });
    db.close();
  });
});

describe('re-pasting personal.private', () => {
  const one = (bag: unknown) => JSON.stringify({ schema: 'beanquery.bags/v1', bags: [bag] });

  test('true on a published bag makes the bean private, and false on a private one publishes it', () => {
    const db = seeded();
    const bagId = bagIdOf(addBag(db, 2, sasaba()));

    expect(repasteBag(db, 2, bagId, one(sasaba({ private: true })))).toMatchObject({ status: 'saved' });
    expect(coffeeOf(db, bagId)?.owner).toBe(2);
    expect(repasteBag(db, 2, bagId, one(sasaba({ private: false })))).toMatchObject({ status: 'saved' });
    expect(coffeeOf(db, bagId)).toEqual({ id: 1, owner: null });
    db.close();
  });

  test('publishing by re-paste with a picked coffee keeps every bag on the pick, and makes no other pool coffee', () => {
    const db = seeded();
    const a = bagIdOf(addBag(db, 2, sasaba({ private: true }, 'Ethiopia Sasaba Lot 2')));
    const b = bagIdOf(addBag(db, 2, sasaba({ private: true }, 'Ethiopia Sasaba Lot 2')));
    const paste = one(sasaba({ private: false }, 'Ethiopia Sasaba Lot 2'));

    expect(repasteBag(db, 2, a, paste, { coffeeChoice: 1 })).toMatchObject({ status: 'saved' });
    expect([coffeeOf(db, a), coffeeOf(db, b)]).toEqual([
      { id: 1, owner: null },
      { id: 1, owner: null },
    ]);
    expect(db.prepare("SELECT count(*) AS n FROM coffee WHERE name = 'Ethiopia Sasaba Lot 2'").get()).toEqual({ n: 0 });
    db.close();
  });

  test('publishing by re-paste onto a pool coffee reports each differing value once', () => {
    const db = seeded();
    const secret = sasaba({ private: true });
    secret.coffee.country = 'Kenya';
    const bagId = bagIdOf(addBag(db, 2, secret));
    const paste = sasaba({ private: false });
    paste.coffee.country = 'Kenya';

    expect(repasteBag(db, 2, bagId, one(paste))).toEqual({
      status: 'saved',
      differences: [{ index: 0, field: 'country', pool: 'Ethiopia', yours: 'Kenya' }],
    });
    db.close();
  });

  test('a re-paste that goes private and then collides on the name undoes the move too', () => {
    const db = seeded();
    addBag(db, 2, sasaba({ private: true }, 'Secret Lot'));
    const bagId = bagIdOf(addBag(db, 2, sasaba()));

    expect(repasteBag(db, 2, bagId, one(sasaba({ private: true }, 'SECRET LOT')))).toMatchObject({
      status: 'name_taken',
    });
    expect(coffeeOf(db, bagId)).toEqual({ id: 1, owner: null });
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE owner_account_id = 2').get()).toEqual({ n: 1 });
    db.close();
  });

  test('publishing by re-paste asks about a close coffee like the bag page does', () => {
    const db = seeded();
    const bagId = bagIdOf(addBag(db, 2, sasaba({ private: true }, 'Ethiopia Sasaba Lot 2')));
    const paste = one(sasaba({ private: false }, 'Ethiopia Sasaba Lot 2'));
    expect(repasteBag(db, 2, bagId, paste)).toMatchObject({ status: 'needs_coffee' });
    expect(coffeeOf(db, bagId)?.owner).toBe(2);
    expect(repasteBag(db, 2, bagId, paste, { coffeeChoice: 'new' })).toMatchObject({ status: 'saved' });
    expect(coffeeOf(db, bagId)?.owner).toBeNull();
    db.close();
  });
});
