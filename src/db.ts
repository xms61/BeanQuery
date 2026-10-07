import { DatabaseSync } from 'node:sqlite';

/** Opens the SQLite database at `path` (a file, or `:memory:` in tests) with foreign keys enforced. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
