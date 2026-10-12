import type { DatabaseSync } from 'node:sqlite';
import { type ContractError, parseBag, parseBagFields } from '../contract/bag-json.js';
import { bagColumns, type ImportResult, Saver, saveDocument } from './import.js';

export type BagState = 'sealed' | 'open' | 'frozen' | 'finished';
const states: readonly BagState[] = ['sealed', 'open', 'frozen', 'finished'];

/**
 * Saves one bag typed in by hand, checked by the same rules as a paste and matched to the pool the same way.
 * Errors name fields from the bag itself (`coffee.farm`), not from a document.
 */
export function addBag(
  db: DatabaseSync,
  accountId: number,
  input: unknown,
  options: { roasterChoice?: number } = {},
): ImportResult {
  const parsed = parseBag(input);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  const choices = options.roasterChoice === undefined ? undefined : { 0: options.roasterChoice };
  return saveDocument(db, accountId, { schema: 'beanquery.bags/v1', bags: [parsed.value] }, 'manual', choices);
}

/**
 * Replaces an own bag's fields with the ones the edit form sends: everything but the roaster, the coffee facts and
 * the private flag. A personal field left out is cleared. Another account's bag answers `not_found`, the same as a
 * bag that doesn't exist, so the answer gives nothing away.
 */
export function editBag(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  input: unknown,
): { status: 'saved' } | { status: 'not_found' } | { status: 'invalid'; errors: ContractError[] } {
  const parsed = parseBagFields(input);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  if (db.prepare('SELECT 1 FROM bag WHERE id = ? AND account_id = ?').get(bagId, accountId) === undefined) {
    return { status: 'not_found' };
  }

  const fields = parsed.value;
  db.exec('BEGIN');
  try {
    const grinderId = fields.brew.grinder === null ? null : new Saver(db, accountId).grinder(fields.brew.grinder);
    const values = bagColumns(fields, grinderId);
    const columns = Object.keys(values);
    db.prepare(
      `UPDATE bag SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND account_id = ?`,
    ).run(...Object.values(values), bagId, accountId);
    // As on import: a published bag's harvest joins its pool coffee's list. A private coffee keeps no list.
    if (fields.harvest !== null) {
      db.prepare(
        `INSERT OR IGNORE INTO coffee_harvest (coffee_id, harvest)
         SELECT c.id, ? FROM bag b JOIN coffee c ON c.id = b.coffee_id
         WHERE b.id = ? AND b.account_id = ? AND c.owner_account_id IS NULL`,
      ).run(fields.harvest, bagId, accountId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: 'saved' };
}

/** Sets an own bag's state by hand. False when the account has no such bag. */
export function setBagState(db: DatabaseSync, accountId: number, bagId: number, state: BagState): boolean {
  if (!states.includes(state)) throw new Error(`A bag's state is sealed, open, frozen or finished, not ${state}`);
  return (
    db.prepare('UPDATE bag SET state = ? WHERE id = ? AND account_id = ?').run(state, bagId, accountId).changes === 1
  );
}

/** Deletes an own bag. Its coffee stays, in the pool or as the account's private coffee. False when there is no such bag. */
export function deleteBag(db: DatabaseSync, accountId: number, bagId: number): boolean {
  return db.prepare('DELETE FROM bag WHERE id = ? AND account_id = ?').run(bagId, accountId).changes === 1;
}
