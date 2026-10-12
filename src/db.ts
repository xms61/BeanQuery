import { DatabaseSync } from 'node:sqlite';

/**
 * Opens the SQLite database at `path` (a file, or `:memory:` in tests) with foreign keys enforced and a 5-second wait
 * for locks. `readOnly` opens an existing file without the right to change it, as a restore does to check a backup.
 */
export function openDatabase(path: string, options: { readOnly?: boolean } = {}): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  db.exec('PRAGMA foreign_keys = ON');
  // Wait for a lock instead of failing at once, so a nightly job and a user's save can overlap.
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
