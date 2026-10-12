import type { DatabaseSync } from 'node:sqlite';
import { roasterNameKey } from './name-key.js';

export interface RoasterRow {
  id: number;
  name: string;
  slug: string;
  source: 'every_coffee' | 'admin';
  /** The account's bags of this roaster. */
  bags: number;
  /** The account's own note on this roaster, which no other account sees. */
  note: string | null;
}

export interface RoasterFilter {
  query?: string;
  /** Only roasters the account has bags of, or has a note on. */
  only?: 'bags' | 'notes';
}

const maxNote = 500;

/**
 * The registered roasters for one account, with its bag count and note on each. A query matches when each of its
 * words starts a word of the roaster's name, ignoring case and accents. Roasters with the account's bags come first,
 * then by name. At most `limit` rows, with the number that matched.
 */
export function listRoasters(
  db: DatabaseSync,
  accountId: number,
  filter: RoasterFilter = {},
  limit = 100,
): { roasters: RoasterRow[]; total: number } {
  const words = roasterNameKey(filter.query ?? '')
    .split(' ')
    .filter(Boolean);
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.name_key, r.slug, r.source, n.note,
         (SELECT count(*) FROM bag b JOIN coffee c ON c.id = b.coffee_id
          WHERE b.account_id = ?1 AND c.roaster_id = r.id) AS bags
       FROM roaster r
       LEFT JOIN roaster_note n ON n.roaster_id = r.id AND n.account_id = ?1
       ORDER BY bags = 0, r.name_key, r.id`,
    )
    .all(accountId)
    .filter((row) => {
      if (filter.only === 'bags' && Number(row.bags) === 0) return false;
      if (filter.only === 'notes' && row.note === null) return false;
      const nameWords = String(row.name_key).split(' ');
      return words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)));
    });
  return { roasters: rows.slice(0, limit).map(toRow), total: rows.length };
}

/** One registered roaster with the account's bag count and note; undefined when there is none with that id. */
export function roasterFor(db: DatabaseSync, accountId: number, roasterId: number): RoasterRow | undefined {
  const row = db
    .prepare(
      `SELECT r.id, r.name, r.slug, r.source, n.note,
         (SELECT count(*) FROM bag b JOIN coffee c ON c.id = b.coffee_id
          WHERE b.account_id = ?1 AND c.roaster_id = r.id) AS bags
       FROM roaster r
       LEFT JOIN roaster_note n ON n.roaster_id = r.id AND n.account_id = ?1
       WHERE r.id = ?2`,
    )
    .get(accountId, roasterId);
  return row === undefined ? undefined : toRow(row);
}

/**
 * Sets the account's private note on a roaster; an empty note removes it. At most 500 characters, as in the bag
 * JSON contract, so an export imports back.
 */
export function setRoasterNote(
  db: DatabaseSync,
  accountId: number,
  roasterId: number,
  note: string,
): { status: 'saved' } | { status: 'not_found' } | { status: 'too_long' } {
  const text = note.trim();
  if (text.length > maxNote) return { status: 'too_long' };
  if (db.prepare('SELECT 1 FROM roaster WHERE id = ?').get(roasterId) === undefined) return { status: 'not_found' };
  if (text === '') {
    db.prepare('DELETE FROM roaster_note WHERE account_id = ? AND roaster_id = ?').run(accountId, roasterId);
  } else {
    db.prepare(
      `INSERT INTO roaster_note (account_id, roaster_id, note) VALUES (?, ?, ?)
       ON CONFLICT (account_id, roaster_id) DO UPDATE SET note = excluded.note`,
    ).run(accountId, roasterId, text);
  }
  return { status: 'saved' };
}

function toRow(row: Record<string, unknown>): RoasterRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    source: row.source === 'admin' ? 'admin' : 'every_coffee',
    bags: Number(row.bags),
    note: row.note === null ? null : String(row.note),
  };
}
