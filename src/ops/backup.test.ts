import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { backupDatabase, restoreDatabase } from './backup.js';

const folders: string[] = [];
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'beanquery-ops-'));
  folders.push(path);
  return path;
}
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function database(path: string, accounts: number): DatabaseSync {
  const db = openDatabase(path);
  migrate(db);
  for (let i = 0; i < accounts; i++) {
    db.prepare(
      "INSERT INTO account (key_hash, created_on, last_seen_on) VALUES (randomblob(32), '2026-10-12', '2026-10-12')",
    ).run();
  }
  return db;
}
const count = (db: DatabaseSync) => Number(db.prepare('SELECT count(*) AS n FROM account').get()?.n);

describe('backupDatabase', () => {
  test('writes a dated copy that opens and holds the data, while the source stays open for writes', async () => {
    const dir = folder();
    const db = database(join(dir, 'live.db'), 3);
    const result = await backupDatabase(db, join(dir, 'backups'), new Date('2026-10-12T03:00:00Z'));
    db.prepare(
      "INSERT INTO account (key_hash, created_on, last_seen_on) VALUES (randomblob(32), '2026-10-12', '2026-10-12')",
    ).run();

    expect(result.file).toBe(join(dir, 'backups', 'beanquery-2026-10-12T030000Z.db'));
    const copy = openDatabase(result.file);
    expect(count(copy)).toBe(3);
    copy.close();
    expect(count(db)).toBe(4);
    expect(readdirSync(join(dir, 'backups'))).toEqual(['beanquery-2026-10-12T030000Z.db']);
    db.close();
  });

  test('keeps the newest backups and removes older ones, and leaves other files alone', async () => {
    const dir = folder();
    const backups = join(dir, 'backups');
    const db = database(join(dir, 'live.db'), 1);
    await backupDatabase(db, backups, new Date('2026-10-01T03:00:00Z'));
    writeFileSync(join(backups, 'notes.txt'), 'mine');
    for (const day of ['02', '03', '04']) await backupDatabase(db, backups, new Date(`2026-10-${day}T03:00:00Z`), 2);

    expect(readdirSync(backups).sort()).toEqual([
      'beanquery-2026-10-03T030000Z.db',
      'beanquery-2026-10-04T030000Z.db',
      'notes.txt',
    ]);
    db.close();
  });
});

describe('restoreDatabase', () => {
  test('puts a backup in place and keeps the replaced file aside', async () => {
    const dir = folder();
    const live = join(dir, 'live.db');
    const db = database(live, 2);
    const { file } = await backupDatabase(db, join(dir, 'backups'), new Date('2026-10-12T03:00:00Z'));
    db.prepare('DELETE FROM account').run();
    db.close();

    const result = restoreDatabase(file, live, new Date('2026-10-12T09:30:00Z'));
    expect(result.replaced).toBe(join(dir, 'live.db.replaced-2026-10-12T093000Z'));
    const restored = openDatabase(live);
    expect(count(restored)).toBe(2);
    restored.close();
    const replaced = openDatabase(result.replaced as string);
    expect(count(replaced)).toBe(0);
    replaced.close();
  });

  test('into a path with no database yet replaces nothing', async () => {
    const dir = folder();
    const db = database(join(dir, 'live.db'), 1);
    const { file } = await backupDatabase(db, join(dir, 'backups'), new Date('2026-10-12T03:00:00Z'));
    db.close();
    expect(restoreDatabase(file, join(dir, 'new.db'), new Date()).replaced).toBeNull();
    expect(existsSync(join(dir, 'new.db'))).toBe(true);
  });

  test('refuses while the database has a journal beside it, which SQLite would roll into the restored file', async () => {
    const dir = folder();
    const live = join(dir, 'live.db');
    const db = database(live, 1);
    const { file } = await backupDatabase(db, join(dir, 'backups'), new Date('2026-10-12T03:00:00Z'));
    db.close();
    for (const suffix of ['-journal', '-wal', '-shm']) {
      writeFileSync(`${live}${suffix}`, 'left by a crash');
      expect(() => restoreDatabase(file, live, new Date())).toThrow(new RegExp(`live\\.db${suffix}`));
      rmSync(`${live}${suffix}`);
    }
    expect(readdirSync(dir).sort()).toEqual(['backups', 'live.db']);
  });

  test('refuses a damaged file, a file that is no BeanQuery database, and one from a newer version', async () => {
    const dir = folder();
    const live = join(dir, 'live.db');
    database(live, 1).close();
    const before = readFileSync(live);

    const damaged = join(dir, 'damaged.db');
    writeFileSync(damaged, 'SQLite format 3\0 but not really');
    const other = openDatabase(join(dir, 'other.db'));
    other.exec('CREATE TABLE note (id INTEGER PRIMARY KEY)');
    other.close();
    const newer = database(join(dir, 'newer.db'), 1);
    newer.exec("INSERT INTO schema_migration (id, name, applied_on) VALUES (999, 'from the future', '2027-01-01')");
    newer.close();

    expect(() => restoreDatabase(damaged, live, new Date())).toThrow(/not a readable SQLite database/);
    expect(() => restoreDatabase(join(dir, 'other.db'), live, new Date())).toThrow(/not a BeanQuery database/);
    expect(() => restoreDatabase(join(dir, 'newer.db'), live, new Date())).toThrow(/newer version/);
    expect(() => restoreDatabase(join(dir, 'missing.db'), live, new Date())).toThrow(/No backup at/);
    expect(readFileSync(live).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((name) => name.includes('replaced'))).toEqual([]);
  });
});
