import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { bagDetail, library, phaseOn } from './library.js';
import { addBag, setBagState } from './manage.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);
const plan = {
  rest: { from: 28, to: 35 },
  peak: { from: 30, to: 60 },
  portion: { from: 28, to: 30 },
  mid_peak: 45,
  tubes: 16,
  dial_in_g: 10,
};

function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  return db;
}

/** Adds fixture bag `index` for an account, with changes, and returns its id. */
function bag(
  db: DatabaseSync,
  accountId: number,
  index: number,
  change: (b: Record<string, unknown>) => void = () => {},
) {
  const input = structuredClone(fixture.bags[index]);
  change(input);
  const result = addBag(db, accountId, input);
  if (result.status !== 'saved') throw new Error(JSON.stringify(result));
  return Number(db.prepare('SELECT max(id) AS id FROM bag').get()?.id);
}
const roastedOn = (date: string | null) => (b: Record<string, unknown>) => {
  b.roast_date = { printed: date, date, status: date === null ? 'missing' : 'verified' };
  b.plan = structuredClone(plan);
};

describe('phaseOn', () => {
  test('counts days from the roast date and names the phase', () => {
    const at = (today: string) => phaseOn('2026-09-18', plan, today);
    expect(at('2026-09-18')).toEqual({ phase: 'resting', day: 0 });
    expect(at('2026-10-15')).toEqual({ phase: 'resting', day: 27 });
    expect(at('2026-10-16')).toEqual({ phase: 'rested', day: 28 });
    expect(at('2026-10-18')).toEqual({ phase: 'peak', day: 30 });
    expect(at('2026-11-17')).toEqual({ phase: 'peak', day: 60 });
    expect(at('2026-11-18')).toEqual({ phase: 'past', day: 61 });
  });

  test('says when there is no roast date or no plan', () => {
    expect(phaseOn(null, plan, '2026-10-12')).toEqual({ phase: 'no_roast_date', day: null });
    expect(phaseOn('2026-09-18', null, '2026-10-12')).toEqual({ phase: 'no_plan', day: 24 });
  });
});

describe('library', () => {
  test('lists only the account’s own bags, unfinished first, newest roast first', () => {
    const db = seeded();
    const old = bag(db, 1, 0, roastedOn('2026-08-01'));
    const fresh = bag(db, 1, 1, roastedOn('2026-10-01'));
    const undated = bag(db, 1, 2, roastedOn(null));
    const done = bag(db, 1, 3, roastedOn('2026-09-20'));
    setBagState(db, 1, done, 'finished', '2026-10-12');
    bag(db, 2, 4, roastedOn('2026-10-01'));

    const result = library(db, 1, '2026-10-12');
    expect(result.total).toBe(4);
    expect(result.bags.map((b) => b.bagId)).toEqual([fresh, old, undated, done]);
    expect(result.bags[0]).toMatchObject({
      coffee: 'Peru La Danta',
      roaster: 'Nord Kaffe',
      roastDate: '2026-10-01',
      day: 11,
      phase: 'resting',
      state: 'sealed',
      private: false,
    });
    expect(result.bags[2]).toMatchObject({ phase: 'no_roast_date', day: null });
    db.close();
  });

  test('filters by state, roaster, process, variety, phase, rating and words, and offers what the bags have', () => {
    const db = seeded();
    const sasaba = bag(db, 1, 0, (b) => {
      roastedOn('2026-09-01')(b);
      (b.personal as Record<string, unknown>) = { rating: 4.5 };
    });
    const peru = bag(db, 1, 1, roastedOn('2026-10-01'));
    const elida = bag(db, 1, 2, (b) => {
      roastedOn('2026-09-10')(b);
      (b.personal as Record<string, unknown>) = { rating: 3, state: 'finished' };
    });
    const ids = (filter: Parameters<typeof library>[3]) =>
      library(db, 1, '2026-10-12', filter).bags.map((b) => b.bagId);

    expect(ids({ state: 'active' })).toEqual([peru, sasaba]);
    expect(ids({ state: 'finished' })).toEqual([elida]);
    expect(ids({ roaster: 'Tanat' })).toEqual([elida]);
    expect(ids({ process: 'washed' }).sort()).toEqual(
      library(db, 1, '2026-10-12')
        .bags.filter((b) => b.process === 'washed')
        .map((b) => b.bagId)
        .sort(),
    );
    const variety = library(db, 1, '2026-10-12').options.varieties[0] as string;
    expect(ids({ variety }).length).toBeGreaterThan(0);
    expect(ids({ phase: 'peak' })).toEqual([sasaba, elida]);
    expect(ids({ minRating: 4 })).toEqual([sasaba]);
    expect(ids({ minRating: 'unrated' })).toEqual([peru]);
    expect(ids({ query: 'peru danta' })).toEqual([peru]);
    expect(ids({ query: 'nord' })).toEqual([peru, sasaba]);

    const { options } = library(db, 1, '2026-10-12', { roaster: 'Tanat' });
    expect(options.roasters).toEqual(['Nord Kaffe', 'Tanat']);
    db.close();
  });
});

describe('bagDetail', () => {
  test('gives the bag with its phase, and whether its bean is in the pool, only to its account', () => {
    const db = seeded();
    const id = bag(db, 1, 0, roastedOn('2026-09-18'));
    const detail = bagDetail(db, 1, id, '2026-10-07');
    expect(detail).toMatchObject({
      bagId: id,
      phase: 'resting',
      day: 19,
      inPool: true,
      collective: null,
      bag: { coffee: { name: 'Ethiopia Sasaba' }, plan },
    });
    expect(bagDetail(db, 2, id, '2026-10-07')).toBeUndefined();

    db.exec(
      `INSERT INTO coffee_rating (coffee_id, rating_rounded, account_band) VALUES (${detail?.coffeeId}, 4.5, '3+')`,
    );
    expect(bagDetail(db, 1, id, '2026-10-07')?.collective).toEqual({ rating: 4.5, band: '3+' });
    db.close();
  });
});
