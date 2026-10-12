import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from './import.js';
import { addRoaster, findRoasters } from './registry.js';

function freshDatabase(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

describe('addRoaster', () => {
  test('adds a roaster every.coffee lacks, which resolves on the next paste', () => {
    const db = freshDatabase();

    const added = addRoaster(db, '  Kaffeerösterei  Müller ');
    expect(added).toEqual({
      id: 1,
      name: 'Kaffeerösterei Müller',
      slug: 'admin:kaffeerosterei-muller',
      source: 'admin',
    });
    expect(findRoasters(db, 'KAFFEERÖSTEREI MÜLLER')).toEqual([added]);
    db.close();
  });

  // Two roasters can share a name (49 names on every.coffee have several slugs), so a shared key is allowed.
  test('gives each admin roaster its own slug when two names share a key', () => {
    const db = freshDatabase();
    addRoaster(db, 'Black & White');

    expect(addRoaster(db, 'Black and White').slug).toBe('admin:black-and-white-2');
    expect(addRoaster(db, 'BLACK AND WHITE').slug).toBe('admin:black-and-white-3');
    db.close();
  });

  test('refuses a name with no letters or digits', () => {
    const db = freshDatabase();

    expect(() => addRoaster(db, '  ')).toThrow(/needs at least one letter or digit/);
    expect(() => addRoaster(db, '!?')).toThrow(/needs at least one letter or digit/);
    db.close();
  });

  test('admin slugs never collide with every.coffee slugs, so a later import leaves them alone', () => {
    const db = freshDatabase();
    const added = addRoaster(db, 'Sey');
    importRoasters(db, [{ slug: 'sey', name: 'Sey', otherNames: [] }]);

    expect(findRoasters(db, 'Sey').map((roaster) => roaster.slug)).toEqual([added.slug, 'sey']);
    db.close();
  });
});

describe('findRoasters', () => {
  test('finds roasters by name key and by alias, each once', () => {
    const db = freshDatabase();
    importRoasters(db, [
      { slug: 'sey', name: 'Sey', otherNames: ['Sey Coffee'] },
      { slug: 'sey-coffee-berlin', name: 'Sey Coffee', otherNames: [] },
      { slug: 'la-cabra', name: 'La Cabra', otherNames: [] },
    ]);

    expect(findRoasters(db, 'sey coffee').map((roaster) => roaster.slug)).toEqual(['sey', 'sey-coffee-berlin']);
    expect(findRoasters(db, 'Nowhere')).toEqual([]);
    db.close();
  });
});
