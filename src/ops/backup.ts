import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { backup, type DatabaseSync } from 'node:sqlite';
import { schemaVersion } from '../db/migrate.js';
import { openDatabase } from '../db.js';

const backupName = /^beanquery-\d{4}-\d{2}-\d{2}T\d{6}Z\.db$/;

/** 2026-10-12T03:00:00.000Z as 2026-10-12T030000Z, which sorts by time and is a valid file name everywhere. */
const stamp = (now: Date) =>
  now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '');

/**
 * Copies the open database into `dir` as beanquery-<UTC time>.db while the app keeps serving, through SQLite's online
 * backup, which gives a consistent copy even with writes going on. The copy is checked with `PRAGMA integrity_check`
 * before it gets its final name, so a backup file that exists is a whole one. Then only the newest `keep` backups stay;
 * other files in `dir` are left alone.
 */
export async function backupDatabase(
  db: DatabaseSync,
  dir: string,
  now: Date,
  keep = 14,
): Promise<{ file: string; removed: string[] }> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `beanquery-${stamp(now)}.db`);
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  try {
    await backup(db, partial);
    checkDatabase(partial);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  renameSync(partial, file);

  const backups = readdirSync(dir)
    .filter((name) => backupName.test(name))
    .sort();
  const removed = backups.slice(0, Math.max(0, backups.length - keep)).map((name) => join(dir, name));
  for (const path of removed) rmSync(path);
  return { file, removed };
}

/**
 * Puts a backup in place of the database at `target`, which the app must not have open: stop it first. The backup is
 * checked before anything changes: it must be a whole SQLite file, a BeanQuery database, and not from a newer version
 * than this code. The replaced database is kept beside it as <target>.replaced-<UTC time>.
 */
export function restoreDatabase(backupFile: string, target: string, now: Date): { replaced: string | null } {
  if (!existsSync(backupFile)) throw new Error(`No backup at ${backupFile}.`);
  // A journal left by a crash belongs to the old file: on the next open SQLite would roll it into the restored one.
  for (const journal of ['-journal', '-wal', '-shm'].map((suffix) => `${target}${suffix}`)) {
    if (existsSync(journal)) {
      throw new Error(
        `${journal} exists, so the database was not closed cleanly or is still open. Stop the app, start and stop it once ` +
          'so SQLite settles the journal, then restore.',
      );
    }
  }
  checkDatabase(backupFile);

  const incoming = `${target}.restoring`;
  copyFileSync(backupFile, incoming);
  let replaced: string | null = null;
  if (existsSync(target)) {
    replaced = `${target}.replaced-${stamp(now)}`;
    renameSync(target, replaced);
  }
  renameSync(incoming, target);
  return { replaced };
}

/** Throws unless the file is a whole SQLite database with BeanQuery's schema, at this code's version or older. */
function checkDatabase(path: string): void {
  let db: DatabaseSync | undefined;
  try {
    let result: unknown;
    try {
      db = openDatabase(path, { readOnly: true });
      result = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    } catch (error) {
      throw new Error(`${path} is not a readable SQLite database.`, { cause: error });
    }
    if (result !== 'ok') throw new Error(`${path} is damaged: ${String(result)}`);
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (?, ?)")
      .all('schema_migration', 'account');
    if (tables.length !== 2) throw new Error(`${path} is not a BeanQuery database.`);
    const version = Number(db.prepare('SELECT max(id) AS id FROM schema_migration').get()?.id ?? 0);
    if (version > schemaVersion) {
      throw new Error(
        `${path} is from a newer version of BeanQuery (schema ${version}, this one knows ${schemaVersion}).`,
      );
    }
  } finally {
    db?.close();
  }
}
