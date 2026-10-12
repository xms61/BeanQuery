import { expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { setTheme, themeOf } from './theme.js';

test('an account keeps its theme, follows the system without one, and takes only a real theme', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-13', '2026-10-13'), (2, randomblob(32), '2026-10-13', '2026-10-13')`);

  expect(themeOf(db, 1)).toBe('system');
  expect(setTheme(db, 1, 'dark')).toBe(true);
  expect(themeOf(db, 1)).toBe('dark');
  expect(themeOf(db, 2)).toBe('system');
  expect(setTheme(db, 1, 'purple')).toBe(false);
  expect(themeOf(db, 1)).toBe('dark');
  expect(setTheme(db, 1, 'system')).toBe(true);
  expect(db.prepare('SELECT theme FROM account WHERE id = 1').get()).toEqual({ theme: null });
  expect(() => db.exec("UPDATE account SET theme = 'system' WHERE id = 2")).toThrow(/CHECK/);
  db.close();
});
