import type { DatabaseSync } from 'node:sqlite';
import { newAccountNumber } from './account.js';

/**
 * Creates an admin account, for the server command run over SSH: the first admin on an empty database, or a new one
 * when the owner has lost theirs. This is the only code that sets `is_admin`; no web route reaches it.
 */
export function createAdmin(db: DatabaseSync, now: Date): { accountId: number; accountNumber: string } {
  const { accountNumber, keyHash } = newAccountNumber();
  const today = now.toISOString().slice(0, 10);
  const row = db
    .prepare('INSERT INTO account (key_hash, is_admin, created_on, last_seen_on) VALUES (?, 1, ?, ?) RETURNING id')
    .get(keyHash, today, today);
  return { accountId: Number(row?.id), accountNumber };
}
