import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from './import.js';
import type { RoasterListing } from './parse.js';

function freshDatabase(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

function roasterRows(db: DatabaseSync): unknown[] {
  return db.prepare('SELECT id, name, name_key, slug, source FROM roaster ORDER BY id').all();
}

const tanat: RoasterListing = { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] };
const sey: RoasterListing = { slug: 'sey', name: 'Sey', otherNames: ['Sey Coffee'] };

describe('importRoasters', () => {
  test('adds each roaster by slug, with its name key and every.coffee as the source', () => {
    const db = freshDatabase();

    expect(importRoasters(db, [tanat, sey])).toEqual({ added: 2, renamed: 0, unchanged: 0, notListed: 0 });
    expect(roasterRows(db)).toEqual([
      { id: 1, name: 'Tanat', name_key: 'tanat', slug: 'tanat-coffee', source: 'every_coffee' },
      { id: 2, name: 'Sey', name_key: 'sey', slug: 'sey', source: 'every_coffee' },
    ]);
    db.close();
  });

  test('stores other spellings on the page as aliases', () => {
    const db = freshDatabase();
    importRoasters(db, [sey, { slug: 'la-cabra', name: 'La Cabra', otherNames: ['LA CABRA'] }]);

    expect(db.prepare('SELECT alias_key, roaster_id FROM roaster_alias ORDER BY alias_key').all()).toEqual([
      { alias_key: 'sey coffee', roaster_id: 1 },
    ]);
    db.close();
  });

  test('running the import twice gives the same rows', () => {
    const db = freshDatabase();
    importRoasters(db, [tanat, sey]);
    const roasters = roasterRows(db);
    const aliases = db.prepare('SELECT * FROM roaster_alias').all();

    expect(importRoasters(db, [tanat, sey])).toEqual({ added: 0, renamed: 0, unchanged: 2, notListed: 0 });
    expect(roasterRows(db)).toEqual(roasters);
    expect(db.prepare('SELECT * FROM roaster_alias').all()).toEqual(aliases);
    db.close();
  });

  test('a roaster renamed on every.coffee keeps its id, because its slug is unchanged', () => {
    const db = freshDatabase();
    importRoasters(db, [tanat, sey]);

    expect(importRoasters(db, [{ ...tanat, name: 'Tanat Coffee' }, sey])).toEqual({
      added: 0,
      renamed: 1,
      unchanged: 1,
      notListed: 0,
    });
    expect(roasterRows(db)[0]).toEqual({
      id: 1,
      name: 'Tanat Coffee',
      name_key: 'tanat coffee',
      slug: 'tanat-coffee',
      source: 'every_coffee',
    });
    db.close();
  });

  test('a roaster missing from a later list stays, with the rows that use it', () => {
    const db = freshDatabase();
    importRoasters(db, [tanat, sey]);
    // Bags don't exist yet; an alias stands in for a row that points at the roaster.
    db.exec("INSERT INTO roaster_alias (alias_key, roaster_id) VALUES ('tanat specialty', 1)");

    expect(importRoasters(db, [sey])).toEqual({ added: 0, renamed: 0, unchanged: 1, notListed: 1 });
    expect(roasterRows(db)).toHaveLength(2);
    expect(db.prepare('SELECT roaster_id FROM roaster_alias WHERE alias_key = ?').get('tanat specialty')).toEqual({
      roaster_id: 1,
    });
    db.close();
  });

  test('leaves roasters the admin added alone', () => {
    const db = freshDatabase();
    db.exec(
      "INSERT INTO roaster (name, name_key, slug, source) VALUES ('Home Roast', 'home roast', 'admin:home-roast', 'admin')",
    );

    expect(importRoasters(db, [tanat])).toEqual({ added: 1, renamed: 0, unchanged: 0, notListed: 0 });
    expect(db.prepare("SELECT name FROM roaster WHERE source = 'admin'").all()).toEqual([{ name: 'Home Roast' }]);
    db.close();
  });

  test('writes nothing when a row fails', () => {
    const db = freshDatabase();
    db.exec(
      "CREATE TRIGGER no_sey BEFORE INSERT ON roaster WHEN NEW.slug = 'sey' BEGIN SELECT RAISE(ABORT, 'no'); END",
    );

    expect(() => importRoasters(db, [tanat, sey])).toThrow();
    expect(roasterRows(db)).toEqual([]);
    db.close();
  });
});
