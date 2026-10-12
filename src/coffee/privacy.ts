import type { DatabaseSync } from 'node:sqlite';
import type { CoffeeChoice, CoffeeQuestion, Difference } from '../bag/import.js';
import { Saver } from '../bag/import.js';
import type { ContractBag } from '../contract/bag-json.js';
import { readCoffee } from './edit.js';
import { closeCoffees } from './match.js';

export type MakePrivateResult =
  | { status: 'saved'; coffeeId: number; movedBags: number }
  | { status: 'not_found' }
  | { status: 'already_private' };

export type PublishResult =
  | { status: 'saved'; coffeeId: number; movedBags: number; differences: Difference[] }
  | { status: 'needs_coffee'; bags: CoffeeQuestion[] }
  | { status: 'not_found' }
  | { status: 'already_published' };

/**
 * Makes a published bean private for one account: every bag of the account on that pool coffee moves to the
 * account's private coffee with the same roaster and name, or to a new private copy of the pool coffee's facts. The
 * pool coffee stays for everyone else, and the account's rating leaves the collective rating at the next rebuild.
 */
export function makeBeanPrivate(db: DatabaseSync, accountId: number, bagId: number): MakePrivateResult {
  return inTransaction(
    db,
    () => applyMakePrivate(db, accountId, bagId),
    (r) => r.status === 'saved',
  );
}

/**
 * Publishes a private bean: the private coffee goes through matching as a new bean would. On an exact pool match, or
 * a close one the user picks, the account's bags move there, the private facts fill its gaps, and the private coffee
 * is deleted. Otherwise the private coffee itself becomes the pool coffee. Either way the bags' harvests are listed,
 * and the account's rating counts at the next rebuild.
 */
export function publishBean(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  options: { coffeeChoice?: CoffeeChoice } = {},
): PublishResult {
  return inTransaction(
    db,
    () => applyPublish(db, accountId, bagId, options.coffeeChoice),
    (r) => r.status === 'saved',
  );
}

/** The move itself, inside the caller's transaction. */
export function applyMakePrivate(db: DatabaseSync, accountId: number, bagId: number): MakePrivateResult {
  const bag = ownBag(db, accountId, bagId);
  if (bag === undefined) return { status: 'not_found' };
  if (bag.owner !== null) return { status: 'already_private' };

  const existing = db
    .prepare('SELECT id FROM coffee WHERE owner_account_id = ? AND roaster_id = ? AND name_key = ?')
    .get(accountId, bag.roasterId, bag.nameKey);
  const target = existing === undefined ? copyToPrivate(db, bag.coffeeId, accountId) : Number(existing.id);
  const movedBags = db
    .prepare('UPDATE bag SET coffee_id = ? WHERE account_id = ? AND coffee_id = ?')
    .run(target, accountId, bag.coffeeId).changes;
  return { status: 'saved', coffeeId: target, movedBags: Number(movedBags) };
}

/** The move itself, inside the caller's transaction. */
export function applyPublish(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  choice: CoffeeChoice | undefined,
): PublishResult {
  const bag = ownBag(db, accountId, bagId);
  if (bag === undefined) return { status: 'not_found' };
  if (bag.owner === null) return { status: 'already_published' };
  const facts = readCoffee(db, bag.coffeeId);
  if (facts === undefined) return { status: 'not_found' };

  const exact = db
    .prepare('SELECT id FROM coffee WHERE owner_account_id IS NULL AND roaster_id = ? AND name_key = ?')
    .get(bag.roasterId, bag.nameKey);
  let target: number | null;
  if (exact !== undefined) {
    target = Number(exact.id);
  } else {
    // Only pool coffees: the bean is leaving the account's private coffees.
    const candidates = closeCoffees(db, accountId, bag.roasterId, bag.nameKey).filter((c) => !c.private);
    if (choice === 'new' || (choice === undefined && candidates.length === 0)) {
      target = null;
    } else if (choice === undefined) {
      return { status: 'needs_coffee', bags: [{ index: 0, entered: facts.name, candidates }] };
    } else {
      const chosen = candidates.find((c) => c.id === choice);
      // A stale or forged choice gets the question again.
      if (chosen === undefined)
        return { status: 'needs_coffee', bags: [{ index: 0, entered: facts.name, candidates }] };
      target = chosen.id;
    }
  }

  const listHarvests = (coffeeId: number) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO coffee_harvest (coffee_id, harvest)
         SELECT ?1, harvest FROM bag WHERE account_id = ?2 AND coffee_id = ?1 AND harvest IS NOT NULL`,
      )
      .run(coffeeId, accountId);

  if (target === null) {
    db.prepare('UPDATE coffee SET owner_account_id = NULL WHERE id = ?').run(bag.coffeeId);
    listHarvests(bag.coffeeId);
    const movedBags = db.prepare('SELECT count(*) AS n FROM bag WHERE coffee_id = ?').get(bag.coffeeId)?.n;
    return { status: 'saved', coffeeId: bag.coffeeId, movedBags: Number(movedBags), differences: [] };
  }

  // The pool coffee's gaps fill from the private facts, logged as edits, exactly as a paste onto it would.
  const save = new Saver(db, accountId);
  const asBag = { coffee: facts, harvest: null, personal: { private: false } } as unknown as ContractBag;
  save.coffee(asBag, 0, bag.roasterId, { id: target, name: facts.name, private: false });
  const movedBags = db
    .prepare('UPDATE bag SET coffee_id = ? WHERE account_id = ? AND coffee_id = ?')
    .run(target, accountId, bag.coffeeId).changes;
  listHarvests(target);
  db.prepare('DELETE FROM coffee WHERE id = ?').run(bag.coffeeId);
  return { status: 'saved', coffeeId: target, movedBags: Number(movedBags), differences: save.differences };
}

function ownBag(db: DatabaseSync, accountId: number, bagId: number) {
  const row = db
    .prepare(
      `SELECT c.id, c.owner_account_id, c.roaster_id, c.name_key
       FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.id = ? AND b.account_id = ?`,
    )
    .get(bagId, accountId);
  if (row === undefined) return undefined;
  return {
    coffeeId: Number(row.id),
    owner: row.owner_account_id === null ? null : Number(row.owner_account_id),
    roasterId: Number(row.roaster_id),
    nameKey: String(row.name_key),
  };
}

/** A private copy of a pool coffee's facts for one account. One of the two places bean facts are copied. */
function copyToPrivate(db: DatabaseSync, poolId: number, accountId: number): number {
  const row = db
    .prepare(
      `INSERT INTO coffee (owner_account_id, roaster_id, name, name_key, country, region, farm, producer,
         process_printed, process_category, altitude_printed, altitude_min_m, altitude_max_m, decaf)
       SELECT ?, roaster_id, name, name_key, country, region, farm, producer, process_printed, process_category,
         altitude_printed, altitude_min_m, altitude_max_m, decaf
       FROM coffee WHERE id = ? RETURNING id`,
    )
    .get(accountId, poolId);
  const copyId = Number(row?.id);
  db.prepare(
    'INSERT INTO coffee_variety (coffee_id, position, name) SELECT ?, position, name FROM coffee_variety WHERE coffee_id = ?',
  ).run(copyId, poolId);
  db.prepare(
    'INSERT INTO coffee_tasting_note (coffee_id, position, note) SELECT ?, position, note FROM coffee_tasting_note WHERE coffee_id = ?',
  ).run(copyId, poolId);
  return copyId;
}

function inTransaction<T>(db: DatabaseSync, work: () => T, keep: (result: T) => boolean): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec(keep(result) ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
