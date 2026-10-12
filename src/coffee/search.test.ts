import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { rebuildCollectiveRatings } from './rating.js';
import { searchPool, startingPoint } from './search.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Account 1 has the five real bags on pool coffees 1 to 5; account 2 has a private bean. */
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
  const doc = structuredClone(fixture);
  doc.bags[0].harvest = '2025/26';
  importBags(db, 1, JSON.stringify(doc), { limits: pasteLimits });
  const secret = structuredClone(fixture.bags[0]);
  secret.coffee.name = 'Secret Sasaba';
  secret.harvest = '2026/27';
  secret.personal = { private: true };
  addBag(db, 2, secret);
  return db;
}

const names = (results: { name: string }[]) => results.map((r) => r.name);

describe('searchPool', () => {
  test('lists every pool coffee by roaster, then name, with its harvests', () => {
    const db = seeded();
    const results = searchPool(db, 3);
    expect(names(results)).toEqual([
      'Ethiopia Sasaba',
      'Peru La Danta',
      'Ethiopia - Elto [Hamasho 72h]',
      'Panama - Audaura [Finca Lorayne GHF DRD]',
      'Panama - Elida [Catuai ASD T4D 1304]',
    ]);
    expect(results[0]).toMatchObject({
      coffeeId: 1,
      roaster: 'Nord Kaffe',
      country: 'Ethiopia',
      region: 'Guji',
      process: 'natural',
      harvests: ['2025/26'],
      rating: null,
      private: false,
    });
    db.close();
  });

  test('finds by any word of the coffee, roaster, origin or variety, ignoring case and accents', () => {
    const db = seeded();
    expect(names(searchPool(db, 3, { query: 'TANAT panama' }))).toEqual([
      'Panama - Audaura [Finca Lorayne GHF DRD]',
      'Panama - Elida [Catuai ASD T4D 1304]',
    ]);
    expect(names(searchPool(db, 3, { query: 'geisha' }))).toEqual(['Panama - Audaura [Finca Lorayne GHF DRD]']);
    expect(names(searchPool(db, 3, { query: 'chiriqui' }))).toEqual(['Panama - Elida [Catuai ASD T4D 1304]']);
    expect(searchPool(db, 3, { query: 'kenya' })).toEqual([]);
    db.close();
  });

  test("never shows another account's private bean, and shows the account's own only when asked", () => {
    const db = seeded();
    expect(names(searchPool(db, 1, { query: 'secret', includeOwnPrivate: true }))).toEqual([]);
    expect(names(searchPool(db, 2, { query: 'secret' }))).toEqual([]);
    expect(searchPool(db, 2, { query: 'secret', includeOwnPrivate: true })).toEqual([
      expect.objectContaining({ name: 'Secret Sasaba', private: true, harvests: [] }),
    ]);
    db.close();
  });

  test('shows the collective rating once it exists', () => {
    const db = seeded();
    for (const accountId of [2, 3, 4]) {
      const bag = structuredClone(fixture.bags[1]);
      bag.personal = { rating: 4.5 };
      addBag(db, accountId, bag);
    }
    rebuildCollectiveRatings(db);
    expect(searchPool(db, 1, { query: 'danta' })[0]?.rating).toEqual({ value: 4.5, band: '3+' });
    db.close();
  });
});

describe('startingPoint', () => {
  test('gives a pool coffee or an own private one with its roaster, never another account’s private coffee', () => {
    const db = seeded();
    const secret = Number(db.prepare("SELECT id FROM coffee WHERE name = 'Secret Sasaba'").get()?.id);
    expect(startingPoint(db, 3, 1)).toMatchObject({
      roaster: 'Nord Kaffe',
      coffee: { name: 'Ethiopia Sasaba', region: 'Guji' },
      private: false,
    });
    expect(startingPoint(db, 2, secret)).toMatchObject({ coffee: { name: 'Secret Sasaba' }, private: true });
    expect(startingPoint(db, 3, secret)).toBeUndefined();
    expect(startingPoint(db, 3, 999)).toBeUndefined();
    db.close();
  });
});
