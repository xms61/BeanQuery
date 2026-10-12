import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { addBag } from '../bag/manage.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from './import.js';
import { listRoasters, roasterFor, setRoasterNote } from './notes.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Three roasters; account 1 has a bag of Tanat, account 2 none. */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
    { slug: 'friedhats', name: 'Friedhats', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  // The fixture's third bag is Tanat's.
  addBag(db, 1, structuredClone(fixture.bags[2]));
  return db;
}

const names = (result: { roasters: { name: string }[] }) => result.roasters.map((r) => r.name);

describe('listRoasters', () => {
  test("puts the account's roasters first, counts only its bags, and finds by the start of a word", () => {
    const db = seeded();
    expect(names(listRoasters(db, 1))).toEqual(['Tanat', 'Friedhats', 'Nord Kaffe']);
    expect(listRoasters(db, 1).roasters[0]).toMatchObject({ bags: 1, note: null });
    expect(names(listRoasters(db, 2))).toEqual(['Friedhats', 'Nord Kaffe', 'Tanat']);
    expect(names(listRoasters(db, 1, { query: 'kaf' }))).toEqual(['Nord Kaffe']);
    expect(names(listRoasters(db, 1, { only: 'bags' }))).toEqual(['Tanat']);
    expect(listRoasters(db, 1, {}, 2)).toMatchObject({
      total: 3,
      roasters: [{ name: 'Tanat' }, { name: 'Friedhats' }],
    });
    db.close();
  });
});

describe('setRoasterNote', () => {
  test("keeps each account's note to itself, and an empty note removes it", () => {
    const db = seeded();
    const nord = Number(db.prepare("SELECT id FROM roaster WHERE slug = 'nord-kaffe'").get()?.id);
    expect(setRoasterNote(db, 1, nord, '  Order on Mondays ')).toEqual({ status: 'saved' });
    expect(roasterFor(db, 1, nord)?.note).toBe('Order on Mondays');
    expect(roasterFor(db, 2, nord)?.note).toBeNull();
    expect(names(listRoasters(db, 1, { only: 'notes' }))).toEqual(['Nord Kaffe']);

    expect(setRoasterNote(db, 1, nord, 'x'.repeat(501))).toEqual({ status: 'too_long' });
    expect(setRoasterNote(db, 1, 999, 'Hi')).toEqual({ status: 'not_found' });
    setRoasterNote(db, 1, nord, '   ');
    expect(db.prepare('SELECT count(*) AS n FROM roaster_note').get()).toEqual({ n: 0 });
    db.close();
  });
});
