import { describe, expect, test } from 'vitest';
import { openDatabase } from './db.js';

describe('openDatabase', () => {
  test('enforces foreign keys, which SQLite leaves off by default', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE roaster (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE bean (id INTEGER PRIMARY KEY, roaster_id INTEGER NOT NULL REFERENCES roaster (id))');

    expect(() => db.exec('INSERT INTO bean (roaster_id) VALUES (42)')).toThrow(/FOREIGN KEY constraint failed/);
    db.close();
  });
});
