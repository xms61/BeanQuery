import type { DatabaseSync } from 'node:sqlite';
import { applyCoffeeEdit, moveBag } from '../coffee/edit.js';
import { type BagFields, type ContractError, parseBag, parseBagFields, parseCoffee } from '../contract/bag-json.js';
import { readBag } from './export.js';
import { bagColumns, type CoffeeChoice, type ImportResult, Saver, saveDocument, today } from './import.js';

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
  options: { roasterChoice?: number; coffeeChoice?: CoffeeChoice } = {},
): ImportResult {
  const parsed = parseBag(input);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  return saveDocument(db, accountId, { schema: 'beanquery.bags/v1', bags: [parsed.value] }, 'manual', {
    roasters: options.roasterChoice === undefined ? undefined : { 0: options.roasterChoice },
    coffees: options.coffeeChoice === undefined ? undefined : { 0: options.coffeeChoice },
  });
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
  if (!ownsBag(db, accountId, bagId)) return { status: 'not_found' };
  db.exec('BEGIN');
  try {
    applyBagFields(db, accountId, bagId, parsed.value);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: 'saved' };
}

export type BagEditResult =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'invalid'; errors: ContractError[] }
  | { status: 'name_taken'; coffeeId: number };

/**
 * Saves the edit form: the bag's own fields and its coffee's facts, together or not at all.
 * - The facts are edited as by `editCoffee`: on a pool coffee for every account, logged; on a private one in place.
 * - A rename onto another coffee of the roaster answers `name_taken` and saves nothing.
 * - With `moveTo`, the answer to that, the bag's fields are saved and the bag moves to that coffee; the facts typed
 *   are dropped, because they belonged to the old coffee. Coffee errors name fields as `coffee.name`.
 */
export function saveBagEdit(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  input: { fields: unknown; coffee: unknown },
  options: { moveTo?: number } = {},
): BagEditResult {
  const fields = parseBagFields(input.fields);
  const coffee = options.moveTo === undefined ? parseCoffee(input.coffee) : undefined;
  const errors = [
    ...(fields.ok ? [] : fields.errors),
    ...(coffee === undefined || coffee.ok
      ? []
      : coffee.errors.map((e) => ({ ...e, path: e.path === '' ? 'coffee' : `coffee.${e.path}` }))),
  ];
  if (!fields.ok || errors.length > 0) return { status: 'invalid', errors };
  if (!ownsBag(db, accountId, bagId)) return { status: 'not_found' };

  db.exec('BEGIN');
  try {
    if (options.moveTo !== undefined) {
      if (!moveBag(db, accountId, bagId, options.moveTo)) {
        db.exec('ROLLBACK');
        return { status: 'not_found' };
      }
    } else if (coffee?.ok) {
      const coffeeId = Number(db.prepare('SELECT coffee_id FROM bag WHERE id = ?').get(bagId)?.coffee_id);
      const edited = applyCoffeeEdit(db, accountId, coffeeId, coffee.value);
      if (edited.status !== 'saved') {
        db.exec('ROLLBACK');
        if (edited.status === 'name_taken') return edited;
        throw new Error(`Editing the bag's own coffee answered ${edited.status}`);
      }
    }
    applyBagFields(db, accountId, bagId, fields.value);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: 'saved' };
}

/**
 * Sets an own bag's verdict from its page: the rating, "would buy again" and the note. The other fields stay.
 * A rating that changes is dated today, for the collective rating.
 */
export function rateBag(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  verdict: { rating: unknown; rebuy: unknown; note: unknown },
): { status: 'saved' } | { status: 'not_found' } | { status: 'invalid'; errors: ContractError[] } {
  const bag = readBag(db, accountId, bagId);
  if (bag === undefined) return { status: 'not_found' };
  const { roaster: _roaster, coffee: _coffee, personal, ...rest } = bag;
  const { private: _private, ...own } = personal ?? {};
  return editBag(db, accountId, bagId, { ...rest, personal: { ...own, ...verdict } });
}

function ownsBag(db: DatabaseSync, accountId: number, bagId: number): boolean {
  return db.prepare('SELECT 1 FROM bag WHERE id = ? AND account_id = ?').get(bagId, accountId) !== undefined;
}

/** Writes an own bag's checked fields inside the caller's transaction. */
function applyBagFields(db: DatabaseSync, accountId: number, bagId: number, fields: BagFields): void {
  const grinderId = fields.brew.grinder === null ? null : new Saver(db, accountId).grinder(fields.brew.grinder);
  const values = { ...bagColumns(fields, grinderId), rated_on: ratedOn(db, bagId, fields.personal?.rating ?? null) };
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
}

/**
 * Sets an own bag's state by hand. Marking it frozen also fills its freeze date with `today`, the account's date, when
 * it has none; a date it has stays, and other states leave it. False when the account has no such bag.
 */
export function setBagState(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  state: BagState,
  today: string,
): boolean {
  if (!states.includes(state)) throw new Error(`A bag's state is sealed, open, frozen or finished, not ${state}`);
  return (
    db
      .prepare(
        `UPDATE bag SET state = ?1, frozen_on = CASE WHEN ?1 = 'frozen' THEN coalesce(frozen_on, ?2) ELSE frozen_on END
         WHERE id = ?3 AND account_id = ?4`,
      )
      .run(state, today, bagId, accountId).changes === 1
  );
}

/** Deletes an own bag. Its coffee stays, in the pool or as the account's private coffee. False when there is no such bag. */
export function deleteBag(db: DatabaseSync, accountId: number, bagId: number): boolean {
  return db.prepare('DELETE FROM bag WHERE id = ? AND account_id = ?').run(bagId, accountId).changes === 1;
}

/**
 * The rating date to store when a bag's rating becomes `rating`: today when it changed, the old date when it didn't,
 * none without a rating. The collective rating takes each account's latest rated bag by this date.
 */
export function ratedOn(db: DatabaseSync, bagId: number, rating: number | null): string | null {
  if (rating === null) return null;
  const current = db.prepare('SELECT rating, rated_on FROM bag WHERE id = ?').get(bagId);
  return current?.rating === rating && current.rated_on !== null ? String(current.rated_on) : today();
}
