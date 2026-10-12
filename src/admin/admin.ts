import type { DatabaseSync } from 'node:sqlite';
import { createInvite, deleteAccount, openInviteCount } from '../account/account.js';
import { type CoffeeWriteResult, readCoffee, setFact, writeCoffeeFacts } from '../coffee/edit.js';
import { applyMakePrivate } from '../coffee/privacy.js';
import { type CoffeeFacts, parseCoffee } from '../contract/bag-json.js';
import { roasterNameKey } from '../roaster/name-key.js';
import { addRoaster, type Roaster } from '../roaster/registry.js';

/**
 * The owner's tools. Every function takes the acting account first and refuses with `not_admin` unless it is an
 * admin, so a web route can't reach an admin action by forgetting a check. None of them sets `is_admin`; only the
 * server command does (`src/account/bootstrap.ts`).
 */
export type NotAdmin = { status: 'not_admin' };

export interface AccountRow {
  accountId: number;
  /** The first 8 hex digits of the key hash: enough to tell accounts apart, useless for signing in. */
  fingerprint: string;
  admin: boolean;
  createdOn: string;
  lastSeenOn: string;
}

export interface EditLogRow {
  editId: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  editedOn: string;
  /** The editor's fingerprint, or null when that account was deleted. Only the admin sees who edited. */
  editor: string | null;
}

export type AdminCoffeeResult = CoffeeWriteResult | NotAdmin;

export function isAdmin(db: DatabaseSync, accountId: number): boolean {
  return db.prepare('SELECT 1 FROM account WHERE id = ? AND is_admin = 1').get(accountId) !== undefined;
}

export function adminCreateInvite(
  db: DatabaseSync,
  adminId: number,
  now: Date,
): { status: 'saved'; code: string; expiresOn: string } | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return { status: 'saved', ...createInvite(db, now) };
}

export function adminOpenInviteCount(db: DatabaseSync, adminId: number, now: Date): number | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return openInviteCount(db, now);
}

/** Every account, most recently seen first. */
export function listAccounts(db: DatabaseSync, adminId: number): AccountRow[] | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return db
    .prepare(
      `SELECT id, substr(hex(key_hash), 1, 8) AS fingerprint, is_admin, created_on, last_seen_on
       FROM account ORDER BY last_seen_on DESC, id`,
    )
    .all()
    .map((row) => ({
      accountId: Number(row.id),
      fingerprint: String(row.fingerprint),
      admin: row.is_admin === 1,
      createdOn: String(row.created_on),
      lastSeenOn: String(row.last_seen_on),
    }));
}

/**
 * Deletes another account and everything it owns, as `deleteAccount` does. The admin's own account is refused here,
 * so the last admin can't lock themselves out from a list; they delete their own from the account page.
 */
export function adminDeleteAccount(
  db: DatabaseSync,
  adminId: number,
  accountId: number,
): { status: 'deleted' } | { status: 'not_found' } | { status: 'own_account' } | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  if (accountId === adminId) return { status: 'own_account' };
  return deleteAccount(db, accountId) ? { status: 'deleted' } : { status: 'not_found' };
}

export function adminAddRoaster(
  db: DatabaseSync,
  adminId: number,
  name: string,
): { status: 'saved'; roaster: Roaster } | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return { status: 'saved', roaster: addRoaster(db, name) };
}

/** Adds another spelling that resolves to a roaster on the next paste. Adding one that exists changes nothing. */
export function addRoasterAlias(
  db: DatabaseSync,
  adminId: number,
  roasterId: number,
  alias: string,
): { status: 'saved' } | { status: 'not_found' } | { status: 'invalid' } | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  const key = roasterNameKey(alias);
  if (key === '') return { status: 'invalid' };
  if (db.prepare('SELECT 1 FROM roaster WHERE id = ?').get(roasterId) === undefined) return { status: 'not_found' };
  db.prepare('INSERT OR IGNORE INTO roaster_alias (alias_key, roaster_id) VALUES (?, ?)').run(key, roasterId);
  return { status: 'saved' };
}

/** Edits a pool coffee's facts, logged under the admin's account like any edit. Private coffees are not reachable. */
export function adminEditCoffee(
  db: DatabaseSync,
  adminId: number,
  coffeeId: number,
  input: unknown,
): AdminCoffeeResult {
  if (!isAdmin(db, adminId)) return notAdmin;
  const parsed = parseCoffee(input);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  return inTransaction(db, () => {
    if (!inPool(db, coffeeId)) return { status: 'not_found' };
    return writeCoffeeFacts(db, adminId, coffeeId, parsed.value);
  });
}

/** A pool coffee's edit log, newest first, with who edited. */
export function editLog(db: DatabaseSync, adminId: number, coffeeId: number): EditLogRow[] | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return db
    .prepare(
      `SELECT e.id, e.field, e.old_value, e.new_value, e.edited_on, CASE WHEN a.id IS NULL THEN NULL ELSE substr(hex(a.key_hash), 1, 8) END AS editor
       FROM coffee_edit e JOIN coffee c ON c.id = e.coffee_id LEFT JOIN account a ON a.id = e.account_id
       WHERE e.coffee_id = ? AND c.owner_account_id IS NULL ORDER BY e.id DESC`,
    )
    .all(coffeeId)
    .map((row) => ({
      editId: Number(row.id),
      field: String(row.field),
      oldValue: row.old_value === null ? null : String(row.old_value),
      newValue: row.new_value === null ? null : String(row.new_value),
      editedOn: String(row.edited_on),
      editor: row.editor === null ? null : String(row.editor),
    }));
}

/**
 * Undoes one logged edit: the field goes back to the edit's old value, and the undo is logged as an edit of its own,
 * so it can be undone too. Undoing a rename whose old name another pool coffee of the roaster has taken since is
 * refused with `name_taken` and that coffee's id.
 */
export function undoEdit(db: DatabaseSync, adminId: number, editId: number): AdminCoffeeResult {
  if (!isAdmin(db, adminId)) return notAdmin;
  return inTransaction(db, () => {
    const edit = db
      .prepare(
        `SELECT e.coffee_id, e.field, e.old_value FROM coffee_edit e JOIN coffee c ON c.id = e.coffee_id
         WHERE e.id = ? AND c.owner_account_id IS NULL`,
      )
      .get(editId);
    if (edit === undefined) return { status: 'not_found' };
    const coffeeId = Number(edit.coffee_id);
    const facts = readCoffee(db, coffeeId) as CoffeeFacts;
    setFact(facts, String(edit.field), edit.old_value === null ? null : String(edit.old_value));
    // The old value can clash with values edited since, such as a minimum altitude above today's maximum.
    const parsed = parseCoffee(facts);
    if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
    return writeCoffeeFacts(db, adminId, coffeeId, parsed.value);
  });
}

/**
 * Merges one pool coffee into another of the same roaster: every bag and harvest moves to the one kept, and the
 * other is deleted with its edit log. The kept coffee's facts stay as they are; the admin edits them separately.
 */
export function mergeCoffees(
  db: DatabaseSync,
  adminId: number,
  keepId: number,
  dropId: number,
): { status: 'merged'; movedBags: number } | { status: 'not_found' } | { status: 'different_roasters' } | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return inTransaction(db, () => {
    if (keepId === dropId || !inPool(db, keepId) || !inPool(db, dropId)) return { status: 'not_found' };
    const roasters = db
      .prepare('SELECT count(DISTINCT roaster_id) AS n FROM coffee WHERE id IN (?, ?)')
      .get(keepId, dropId);
    if (Number(roasters?.n) !== 1) return { status: 'different_roasters' };
    const movedBags = db.prepare('UPDATE bag SET coffee_id = ? WHERE coffee_id = ?').run(keepId, dropId).changes;
    db.prepare(
      'INSERT OR IGNORE INTO coffee_harvest (coffee_id, harvest) SELECT ?, harvest FROM coffee_harvest WHERE coffee_id = ?',
    ).run(keepId, dropId);
    db.prepare('DELETE FROM coffee WHERE id = ?').run(dropId);
    return { status: 'merged', movedBags: Number(movedBags) };
  });
}

/**
 * Deletes a pool coffee. Each account with bags on it gets them moved to its own private coffee of that roaster and
 * name, or to a private copy of the facts, exactly as when a user makes the bean private, so no bag is lost.
 */
export function deletePoolCoffee(
  db: DatabaseSync,
  adminId: number,
  coffeeId: number,
): { status: 'deleted'; movedBags: number } | { status: 'not_found' } | NotAdmin {
  if (!isAdmin(db, adminId)) return notAdmin;
  return inTransaction(db, () => {
    if (!inPool(db, coffeeId)) return { status: 'not_found' };
    const owners = db
      .prepare('SELECT account_id, min(id) AS bag_id FROM bag WHERE coffee_id = ? GROUP BY account_id')
      .all(coffeeId);
    let movedBags = 0;
    for (const owner of owners) {
      const moved = applyMakePrivate(db, Number(owner.account_id), Number(owner.bag_id));
      if (moved.status !== 'saved') throw new Error(`Could not move the bags of account ${owner.account_id}`);
      movedBags += moved.movedBags;
    }
    db.prepare('DELETE FROM coffee WHERE id = ?').run(coffeeId);
    return { status: 'deleted', movedBags };
  });
}

const notAdmin: NotAdmin = { status: 'not_admin' };

function inPool(db: DatabaseSync, coffeeId: number): boolean {
  return db.prepare('SELECT 1 FROM coffee WHERE id = ? AND owner_account_id IS NULL').get(coffeeId) !== undefined;
}

/** Runs the work in a transaction, kept only when it succeeded. */
function inTransaction<T extends { status: string }>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec(['saved', 'merged', 'deleted'].includes(result.status) ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
