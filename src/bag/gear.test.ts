import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { deleteGrinder, editGrinder, listGrinders } from './gear.js';
import { addBag } from './manage.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

/** Account 1 has two grinders, the Ode used by one bag; account 2 has one. */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [{ slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] }]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
      (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  // Creates grinder 1, the Ode, with its bag.
  addBag(db, 1, structuredClone(fixture.bags[0]));
  db.exec(
    `INSERT INTO grinder (id, account_id, name, note) VALUES (2, 1, 'Comandante', 'Travel'), (3, 2, 'Niche Zero', NULL)`,
  );
  return db;
}

describe('the gear', () => {
  test("lists only the account's grinders, with how many of its bags use each", () => {
    const db = seeded();
    expect(listGrinders(db, 1)).toEqual([
      { id: 2, name: 'Comandante', note: 'Travel', bags: 0 },
      { id: 1, name: 'Fellow Ode Gen 2', note: null, bags: 1 },
    ]);
    db.close();
  });

  test("renames a grinder and sets its note, but not onto another of its names, nor another account's", () => {
    const db = seeded();
    expect(editGrinder(db, 1, 1, { name: ' Ode Gen 2 ', note: 'SSP burrs' })).toEqual({ status: 'saved' });
    expect(listGrinders(db, 1)[1]).toEqual({ id: 1, name: 'Ode Gen 2', note: 'SSP burrs', bags: 1 });
    expect(editGrinder(db, 1, 1, { name: 'comandante', note: '' })).toEqual({ status: 'name_taken' });
    expect(editGrinder(db, 1, 1, { name: ' ', note: '' })).toMatchObject({ status: 'invalid' });
    expect(editGrinder(db, 1, 3, { name: 'Mine', note: '' })).toEqual({ status: 'not_found' });
    expect(db.prepare('SELECT name FROM grinder WHERE id = 3').get()).toEqual({ name: 'Niche Zero' });
    db.close();
  });

  test('deletes only an unused own grinder', () => {
    const db = seeded();
    expect(deleteGrinder(db, 1, 1)).toEqual({ status: 'in_use', bags: 1 });
    expect(deleteGrinder(db, 1, 3)).toEqual({ status: 'not_found' });
    expect(deleteGrinder(db, 1, 2)).toEqual({ status: 'deleted' });
    expect(listGrinders(db, 1).map((g) => g.name)).toEqual(['Fellow Ode Gen 2']);
    db.close();
  });
});
