import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { type CoffeeFacts, type ContractError, parseCoffee } from '../contract/bag-json.js';
import { coffeeNameKey } from './name-key.js';

export type CoffeeEditResult =
  | { status: 'saved'; changed: string[] }
  | { status: 'not_found' }
  | { status: 'not_allowed' }
  | { status: 'name_taken'; coffeeId: number }
  | { status: 'invalid'; errors: ContractError[] };

/** What writing facts can return: everything but the access refusal, which the caller decides. */
export type CoffeeWriteResult = Exclude<CoffeeEditResult, { status: 'not_allowed' }>;

// A coffee's single-value facts, in the order edits are applied and logged, with how each is read from the form.
const scalarFacts: [column: string, read: (facts: CoffeeFacts) => SQLInputValue][] = [
  ['name', (f) => f.name],
  ['country', (f) => f.country],
  ['region', (f) => f.region],
  ['farm', (f) => f.farm],
  ['producer', (f) => f.producer],
  ['process_printed', (f) => f.process.printed],
  ['process_category', (f) => f.process.category],
  ['altitude_printed', (f) => f.altitude.printed],
  ['altitude_min_m', (f) => f.altitude.min_m],
  ['altitude_max_m', (f) => f.altitude.max_m],
  ['decaf', (f) => (f.decaf ? 1 : 0)],
];

const listFacts = [
  { field: 'varieties', table: 'coffee_variety', column: 'name', read: (f: CoffeeFacts) => f.varieties },
  { field: 'tasting_notes', table: 'coffee_tasting_note', column: 'note', read: (f: CoffeeFacts) => f.tasting_notes },
] as const;

/**
 * Replaces a coffee's facts with the ones the form sends.
 * - A pool coffee changes for every account. Only an account with a bag on it may edit it, and every changed field
 *   is logged so the admin can undo it.
 * - An own private coffee is edited in place, without the log.
 * - A rename onto another coffee of the same roaster, in the pool or among the account's private coffees, is refused
 *   with that coffee's id, so the user can move their bag there instead.
 */
export function editCoffee(db: DatabaseSync, accountId: number, coffeeId: number, input: unknown): CoffeeEditResult {
  const parsed = parseCoffee(input);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  db.exec('BEGIN');
  try {
    const result = applyCoffeeEdit(db, accountId, coffeeId, parsed.value);
    db.exec(result.status === 'saved' ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** The edit itself, inside the caller's transaction. The facts must already be checked. */
export function applyCoffeeEdit(
  db: DatabaseSync,
  accountId: number,
  coffeeId: number,
  facts: CoffeeFacts,
): CoffeeEditResult {
  const denied = checkAccess(db, accountId, coffeeId);
  if (denied !== undefined) return denied;
  return writeCoffeeFacts(db, accountId, coffeeId, facts);
}

/**
 * Writes a coffee's facts and logs each changed field of a pool coffee under the editor's account, without checking
 * who may edit it: callers do that first. Used by the user's edit and by the admin's edit and undo.
 */
export function writeCoffeeFacts(
  db: DatabaseSync,
  editorId: number,
  coffeeId: number,
  facts: CoffeeFacts,
): CoffeeWriteResult {
  const row = db.prepare('SELECT * FROM coffee WHERE id = ?').get(coffeeId) as
    | Record<string, SQLInputValue>
    | undefined;
  if (row === undefined) return { status: 'not_found' };
  const accountId = row.owner_account_id === null ? editorId : Number(row.owner_account_id);
  const inPool = row.owner_account_id === null;

  const nameKey = coffeeNameKey(facts.name);
  if (nameKey !== row.name_key) {
    const taken = db
      .prepare(
        `SELECT id FROM coffee WHERE roaster_id = ? AND name_key = ? AND id != ?
           AND owner_account_id IS ?`,
      )
      .get(row.roaster_id as number, nameKey, coffeeId, inPool ? null : accountId);
    if (taken !== undefined) return { status: 'name_taken', coffeeId: Number(taken.id) };
  }

  const changed: string[] = [];
  const log = (field: string, oldValue: string | null, newValue: string | null) => {
    changed.push(field);
    if (!inPool) return;
    db.prepare(
      `INSERT INTO coffee_edit (coffee_id, account_id, field, old_value, new_value, edited_on)
       VALUES (?, ?, ?, ?, ?, date('now'))`,
    ).run(coffeeId, editorId, field, oldValue, newValue);
  };

  for (const [column, read] of scalarFacts) {
    const next = read(facts);
    const previous = row[column] as SQLInputValue;
    if (previous === next) continue;
    db.prepare(`UPDATE coffee SET ${column} = ? WHERE id = ?`).run(next, coffeeId);
    if (column === 'name') db.prepare('UPDATE coffee SET name_key = ? WHERE id = ?').run(nameKey, coffeeId);
    log(column, asText(column, previous), asText(column, next));
  }
  for (const { field, table, column, read } of listFacts) {
    const previous = readList(db, table, column, coffeeId);
    const next = read(facts);
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    db.prepare(`DELETE FROM ${table} WHERE coffee_id = ?`).run(coffeeId);
    const insert = db.prepare(`INSERT INTO ${table} (coffee_id, position, ${column}) VALUES (?, ?, ?)`);
    next.forEach((value, position) => {
      insert.run(coffeeId, position, value);
    });
    log(field, JSON.stringify(previous), JSON.stringify(next));
  }
  return { status: 'saved', changed };
}

/**
 * Applies one value the user picked with "Use mine" after a paste reported it as differing. `yours` is the value as
 * the difference carried it: text, a number as text, `true` or `false`, or a list as JSON.
 */
export function useMine(
  db: DatabaseSync,
  accountId: number,
  coffeeId: number,
  field: string,
  yours: string | null,
): CoffeeEditResult {
  // Before reading or checking anything: a check error on a stored value would reveal another account's facts.
  const denied = checkAccess(db, accountId, coffeeId);
  if (denied !== undefined) return denied;
  const facts = readCoffee(db, coffeeId) as CoffeeFacts;
  setFact(facts, field, yours);
  return editCoffee(db, accountId, coffeeId, facts);
}

/**
 * Sets one field of a coffee's facts from its logged form: text, a number as text, `true` or `false`, or a list as
 * JSON, as `coffee_edit` rows and paste differences carry it. Throws for a name that is not a coffee fact.
 */
export function setFact(facts: CoffeeFacts, field: string, value: string | null): void {
  const text = (value: string | null) => value;
  const setters: Record<string, (value: string | null) => void> = {
    name: (v) => {
      facts.name = v ?? '';
    },
    country: (v) => {
      facts.country = text(v);
    },
    region: (v) => {
      facts.region = text(v);
    },
    farm: (v) => {
      facts.farm = text(v);
    },
    producer: (v) => {
      facts.producer = text(v);
    },
    process_printed: (v) => {
      facts.process.printed = text(v);
    },
    process_category: (v) => {
      facts.process.category = v as CoffeeFacts['process']['category'];
    },
    altitude_printed: (v) => {
      facts.altitude.printed = text(v);
    },
    altitude_min_m: (v) => {
      facts.altitude.min_m = v === null ? null : Number(v);
    },
    altitude_max_m: (v) => {
      facts.altitude.max_m = v === null ? null : Number(v);
    },
    decaf: (v) => {
      facts.decaf = v === 'true';
    },
    varieties: (v) => {
      facts.varieties = parseList(v);
    },
    tasting_notes: (v) => {
      facts.tasting_notes = parseList(v);
    },
  };
  const set = Object.hasOwn(setters, field) ? setters[field] : undefined;
  if (set === undefined) throw new Error(`${field} is not a coffee fact`);
  set(value);
}

/**
 * Moves an own bag onto another coffee: a pool coffee, or one of the account's private coffees. Offered after a
 * rename collides. False when the bag or the coffee is not the account's to use.
 */
export function moveBag(db: DatabaseSync, accountId: number, bagId: number, toCoffeeId: number): boolean {
  const moved =
    db
      .prepare(
        // The target must be the same kind as the bag's coffee, pool or own private, and of the same roaster: moving
        // between kinds would publish a private bean or hide a published one, which is the private and publish step's
        // job.
        `UPDATE bag SET coffee_id = ?1 WHERE id = ?2 AND account_id = ?3
           AND EXISTS (
             SELECT 1 FROM coffee target JOIN coffee current ON current.id = bag.coffee_id
             WHERE target.id = ?1 AND target.roaster_id = current.roaster_id
               AND target.owner_account_id IS current.owner_account_id
               AND (target.owner_account_id IS NULL OR target.owner_account_id = ?3))`,
      )
      .run(toCoffeeId, bagId, accountId).changes === 1;
  if (moved) {
    db.prepare(
      `INSERT OR IGNORE INTO coffee_harvest (coffee_id, harvest)
       SELECT c.id, b.harvest FROM bag b JOIN coffee c ON c.id = b.coffee_id
       WHERE b.id = ? AND b.harvest IS NOT NULL AND c.owner_account_id IS NULL`,
    ).run(bagId);
  }
  return moved;
}

/**
 * Whether an account may edit a coffee: `not_found` for a missing coffee or another account's private one, alike, and
 * `not_allowed` for a pool coffee the account has no bag on. Undefined when it may.
 */
function checkAccess(
  db: DatabaseSync,
  accountId: number,
  coffeeId: number,
): { status: 'not_found' } | { status: 'not_allowed' } | undefined {
  const row = db
    .prepare('SELECT owner_account_id FROM coffee WHERE id = ? AND (owner_account_id IS NULL OR owner_account_id = ?)')
    .get(coffeeId, accountId);
  if (row === undefined) return { status: 'not_found' };
  if (row.owner_account_id !== null) return undefined;
  const hasBag = db.prepare('SELECT 1 FROM bag WHERE coffee_id = ? AND account_id = ?').get(coffeeId, accountId);
  return hasBag === undefined ? { status: 'not_allowed' } : undefined;
}

/** A coffee's facts in the contract's shape. Not scoped to an account: callers check access first. */
export function readCoffee(db: DatabaseSync, coffeeId: number): CoffeeFacts | undefined {
  const row = db.prepare('SELECT * FROM coffee WHERE id = ?').get(coffeeId);
  if (row === undefined) return undefined;
  const textOf = (value: unknown) => (value === null ? null : String(value));
  const numberOf = (value: unknown) => (value === null ? null : Number(value));
  return {
    name: String(row.name),
    country: textOf(row.country),
    region: textOf(row.region),
    farm: textOf(row.farm),
    producer: textOf(row.producer),
    varieties: readList(db, 'coffee_variety', 'name', coffeeId),
    process: {
      printed: textOf(row.process_printed),
      category: textOf(row.process_category) as CoffeeFacts['process']['category'],
    },
    altitude: {
      printed: textOf(row.altitude_printed),
      min_m: numberOf(row.altitude_min_m),
      max_m: numberOf(row.altitude_max_m),
    },
    tasting_notes: readList(db, 'coffee_tasting_note', 'note', coffeeId),
    decaf: row.decaf === 1,
  };
}

function readList(db: DatabaseSync, table: string, column: string, coffeeId: number): string[] {
  return db
    .prepare(`SELECT ${column} AS value FROM ${table} WHERE coffee_id = ? ORDER BY position`)
    .all(coffeeId)
    .map((row) => String(row.value));
}

function asText(column: string, value: SQLInputValue): string | null {
  if (value === null) return null;
  if (column === 'decaf') return String(value === 1);
  return String(value);
}

/**
 * A list as JSON from a difference or the edit log. No value is the empty list, as an edit that filled an empty list
 * logs it. Anything else becomes a value the contract check will refuse.
 */
function parseList(value: string | null): string[] {
  if (value === null) return [];
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list) ? list : (value as unknown as string[]);
  } catch {
    return value as unknown as string[];
  }
}
