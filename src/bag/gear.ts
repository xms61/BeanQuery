import type { DatabaseSync } from 'node:sqlite';

export interface Grinder {
  id: number;
  name: string;
  note: string | null;
  /** The account's bags that use it. */
  bags: number;
}

const maxText = 500;

/** The account's grinders, as bags and imports created them, by name. */
export function listGrinders(db: DatabaseSync, accountId: number): Grinder[] {
  return db
    .prepare(
      `SELECT g.id, g.name, g.note, (SELECT count(*) FROM bag b WHERE b.grinder_id = g.id AND b.account_id = ?1) AS bags
       FROM grinder g WHERE g.account_id = ?1 ORDER BY lower(g.name), g.id`,
    )
    .all(accountId)
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      note: row.note === null ? null : String(row.note),
      bags: Number(row.bags),
    }));
}

/**
 * Renames an own grinder and sets its note; an empty note removes it. Every bag using it shows the new name. A name
 * another of the account's grinders has, ignoring case and spaces, is refused: bags find their grinder by name.
 */
export function editGrinder(
  db: DatabaseSync,
  accountId: number,
  grinderId: number,
  input: { name: string; note: string },
): { status: 'saved' } | { status: 'not_found' } | { status: 'invalid'; message: string } | { status: 'name_taken' } {
  const name = input.name.trim();
  const note = input.note.trim();
  if (name === '') return { status: 'invalid', message: 'A grinder needs a name' };
  if (name.length > maxText || note.length > maxText) {
    return { status: 'invalid', message: `At most ${maxText} characters` };
  }
  const own = db.prepare('SELECT 1 FROM grinder WHERE id = ? AND account_id = ?').get(grinderId, accountId);
  if (own === undefined) return { status: 'not_found' };
  const taken = db
    .prepare('SELECT 1 FROM grinder WHERE account_id = ? AND id != ? AND lower(trim(name)) = lower(?)')
    .get(accountId, grinderId, name);
  if (taken !== undefined) return { status: 'name_taken' };
  db.prepare('UPDATE grinder SET name = ?, note = ? WHERE id = ? AND account_id = ?').run(
    name,
    note === '' ? null : note,
    grinderId,
    accountId,
  );
  return { status: 'saved' };
}

/** Deletes an own grinder no bag uses. A used one stays: its bags would lose their grinder. */
export function deleteGrinder(
  db: DatabaseSync,
  accountId: number,
  grinderId: number,
): { status: 'deleted' } | { status: 'not_found' } | { status: 'in_use'; bags: number } {
  const grinder = listGrinders(db, accountId).find((g) => g.id === grinderId);
  if (grinder === undefined) return { status: 'not_found' };
  if (grinder.bags > 0) return { status: 'in_use', bags: grinder.bags };
  db.prepare('DELETE FROM grinder WHERE id = ? AND account_id = ?').run(grinderId, accountId);
  return { status: 'deleted' };
}
