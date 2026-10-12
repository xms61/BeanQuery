import { describe, expect, test } from 'vitest';
import { openDatabase } from '../db.js';
import { migrate } from './migrate.js';

function schemaOf(db: ReturnType<typeof openDatabase>): unknown[] {
  return db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
}

describe('migrate', () => {
  test('creates the roaster tables on an empty database', () => {
    const db = openDatabase(':memory:');
    migrate(db);

    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((row) => row.name)).toEqual(['roaster', 'roaster_alias', 'schema_migration']);
    db.close();
  });

  test('running the migrations twice changes nothing', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const before = schemaOf(db);
    const applied = db.prepare('SELECT id FROM schema_migration ORDER BY id').all();

    migrate(db);

    expect(schemaOf(db)).toEqual(before);
    expect(db.prepare('SELECT id FROM schema_migration ORDER BY id').all()).toEqual(applied);
    db.close();
  });

  test('allows one roaster per slug', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const insert = db.prepare("INSERT INTO roaster (name, name_key, slug, source) VALUES (?, ?, ?, 'every_coffee')");
    insert.run('Tanat', 'tanat', 'tanat-coffee');

    expect(() => insert.run('Tanat Coffee', 'tanat coffee', 'tanat-coffee')).toThrow(/UNIQUE constraint failed/);
    db.close();
  });

  test('rejects a source other than every_coffee or admin', () => {
    const db = openDatabase(':memory:');
    migrate(db);

    expect(() => db.exec("INSERT INTO roaster (name, name_key, slug, source) VALUES ('A', 'a', 'a', 'user')")).toThrow(
      /CHECK constraint failed/,
    );
    db.close();
  });

  test('lets one alias belong to two roasters, but not twice to the same one', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.exec(`INSERT INTO roaster (id, name, name_key, slug, source) VALUES
      (1, 'Rose', 'rose', 'rose-1', 'every_coffee'), (2, 'Rose', 'rose', 'rose-2', 'every_coffee')`);
    const alias = db.prepare('INSERT INTO roaster_alias (alias_key, roaster_id) VALUES (?, ?)');
    alias.run('rose roasters', 1);
    alias.run('rose roasters', 2);

    expect(() => alias.run('rose roasters', 1)).toThrow(/UNIQUE constraint failed/);
    expect(() => alias.run('ghost', 99)).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });
});
