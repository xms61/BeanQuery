import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { coffeeNameKey } from '../coffee/name-key.js';
import { type BagsDocument, type ContractError, type ContractLimits, parseBagsJson } from '../contract/bag-json.js';
import { roasterNameKey } from '../roaster/name-key.js';
import { findRoasters, type Roaster, suggestRoasters } from '../roaster/registry.js';

type ContractBag = BagsDocument['bags'][number];
type RoasterRef = ContractBag['roaster'];

export interface ImportOptions {
  limits: ContractLimits;
  /** The roaster the user picked for a bag, by the bag's index, after a `needs_roaster` answer. */
  roasterChoices?: Record<number, number>;
}

/** A question for the user: which registered roaster a bag means. Nothing is saved until every bag has one. */
export interface RoasterQuestion {
  index: number;
  entered: string;
  /** `ambiguous`: several roasters share the name. `unknown`: none has it; the candidates are similar names. */
  reason: 'ambiguous' | 'unknown';
  candidates: Roaster[];
}

/** A pool coffee's value that differs from the pasted one. The pool keeps its value until the user picks theirs. */
export interface Difference {
  index: number;
  field: string;
  pool: string | null;
  yours: string | null;
}

export type ImportResult =
  | { status: 'saved'; bagIds: number[]; differences: Difference[] }
  | { status: 'needs_roaster'; bags: RoasterQuestion[] }
  | { status: 'invalid'; errors: ContractError[] };

/**
 * Saves pasted or uploaded bags into one account, all in one transaction or not at all. Each bag's roaster must
 * resolve first. A published bean joins the pool coffee with the same roaster and name, filling its gaps, or creates
 * one; a private bean uses only the account's own private coffees.
 */
export function importBags(db: DatabaseSync, accountId: number, json: string, options: ImportOptions): ImportResult {
  const parsed = parseBagsJson(json, options.limits);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  const document = parsed.value;

  const resolved: { roaster: Roaster; confirmed: boolean }[] = [];
  const questions: RoasterQuestion[] = [];
  document.bags.forEach((bag, index) => {
    const answer = resolveRoaster(db, bag.roaster, options.roasterChoices?.[index]);
    if ('roaster' in answer) resolved.push(answer);
    else questions.push({ index, entered: bag.roaster.name, ...answer });
  });
  if (questions.length > 0) return { status: 'needs_roaster', bags: questions };

  const notes = resolveRoasterNotes(db, document.roaster_notes ?? []);
  if ('errors' in notes) return { status: 'invalid', errors: notes.errors };

  const save = new Saver(db, accountId);
  db.exec('BEGIN');
  try {
    for (const grinder of document.grinders ?? []) save.grinder(grinder.name, grinder.note);
    const bagIds = document.bags.map((bag, index) => {
      const { roaster, confirmed } = resolved[index] as { roaster: Roaster; confirmed: boolean };
      if (confirmed) save.alias(bag.roaster.name, roaster.id);
      return save.bag(bag, index, roaster.id);
    });
    for (const { roasterId, note } of notes.resolved) save.roasterNote(roasterId, note);
    db.exec('COMMIT');
    return { status: 'saved', bagIds, differences: save.differences };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function resolveRoaster(
  db: DatabaseSync,
  ref: RoasterRef,
  choice: number | undefined,
): { roaster: Roaster; confirmed: boolean } | Omit<RoasterQuestion, 'index' | 'entered'> {
  const question = askRoaster(db, ref);
  if ('roaster' in question || choice === undefined) return question;

  // Aliases are shared by every account, so a choice must be one the question offered: anything else could point a
  // spelling at the wrong roaster for everyone.
  const chosen = question.candidates.find((candidate) => candidate.id === choice);
  if (chosen === undefined) {
    throw new Error(`The roaster chosen for ${ref.name}, roaster ${choice}, is not one of the roasters offered`);
  }
  // Only a new spelling is worth an alias. A pick between roasters that share the name adds none.
  return { roaster: chosen, confirmed: question.reason === 'unknown' };
}

function askRoaster(
  db: DatabaseSync,
  ref: RoasterRef,
): { roaster: Roaster; confirmed: false } | Omit<RoasterQuestion, 'index' | 'entered'> {
  if (ref.slug != null) {
    const bySlug = db.prepare('SELECT id, name, slug, source FROM roaster WHERE slug = ?').get(ref.slug);
    if (bySlug !== undefined) return { roaster: bySlug as unknown as Roaster, confirmed: false };
  }
  const matches = findRoasters(db, ref.name);
  if (matches.length === 1) return { roaster: matches[0] as Roaster, confirmed: false };
  if (matches.length > 1) return { reason: 'ambiguous', candidates: matches };
  return { reason: 'unknown', candidates: suggestRoasters(db, ref.name) };
}

function resolveRoasterNotes(
  db: DatabaseSync,
  notes: NonNullable<BagsDocument['roaster_notes']>,
): { resolved: { roasterId: number; note: string }[] } | { errors: ContractError[] } {
  const errors: ContractError[] = [];
  const resolved: { roasterId: number; note: string }[] = [];
  const seen = new Map<number, number>();
  notes.forEach((entry, index) => {
    const answer = resolveRoaster(db, entry.roaster, undefined);
    const path = `roaster_notes[${index}]`;
    if (!('roaster' in answer)) {
      errors.push({ path, message: `The roaster ${entry.roaster.name} doesn't resolve to one registered roaster` });
      return;
    }
    const earlier = seen.get(answer.roaster.id);
    if (earlier !== undefined) {
      errors.push({ path, message: `Names the same roaster as roaster_notes[${earlier}]; give one note per roaster` });
      return;
    }
    seen.set(answer.roaster.id, index);
    resolved.push({ roasterId: answer.roaster.id, note: entry.note });
  });
  return errors.length > 0 ? { errors } : { resolved };
}

const bool = (value: boolean | null | undefined) => (value == null ? null : value ? 1 : 0);

// The pool coffee's facts in the order they are compared, with how each is read from a pasted bag.
const scalarFacts: [column: string, read: (coffee: ContractBag['coffee']) => string | number | null][] = [
  ['country', (c) => c.country],
  ['region', (c) => c.region],
  ['farm', (c) => c.farm],
  ['producer', (c) => c.producer],
  ['process_printed', (c) => c.process.printed],
  ['process_category', (c) => c.process.category],
  ['altitude_printed', (c) => c.altitude.printed],
  ['altitude_min_m', (c) => c.altitude.min_m],
  ['altitude_max_m', (c) => c.altitude.max_m],
];

/** The writes of one import, scoped to one account. Runs inside the caller's transaction. */
class Saver {
  readonly differences: Difference[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly accountId: number,
  ) {}

  /** The account's grinder with this name, ignoring case and spaces, created if missing. A given note replaces the old one. */
  grinder(enteredName: string, note?: string | null): number {
    const name = enteredName.trim();
    const existing = this.db
      .prepare('SELECT id FROM grinder WHERE account_id = ? AND lower(trim(name)) = lower(?)')
      .get(this.accountId, name);
    if (existing !== undefined) {
      if (note != null) this.db.prepare('UPDATE grinder SET note = ? WHERE id = ?').run(note, Number(existing.id));
      return Number(existing.id);
    }
    const created = this.db
      .prepare('INSERT INTO grinder (account_id, name, note) VALUES (?, ?, ?) RETURNING id')
      .get(this.accountId, name, note ?? null);
    return Number(created?.id);
  }

  /** Stores a spelling the user confirmed for a roaster, so the next paste resolves it without asking. */
  alias(enteredName: string, roasterId: number): void {
    const key = roasterNameKey(enteredName);
    const roaster = this.db.prepare('SELECT name_key FROM roaster WHERE id = ?').get(roasterId);
    if (key !== '' && key !== roaster?.name_key) {
      this.db.prepare('INSERT OR IGNORE INTO roaster_alias (alias_key, roaster_id) VALUES (?, ?)').run(key, roasterId);
    }
  }

  roasterNote(roasterId: number, note: string): void {
    this.db
      .prepare(
        `INSERT INTO roaster_note (account_id, roaster_id, note) VALUES (?, ?, ?)
         ON CONFLICT (account_id, roaster_id) DO UPDATE SET note = excluded.note`,
      )
      .run(this.accountId, roasterId, note);
  }

  bag(bag: ContractBag, index: number, roasterId: number): number {
    const isPrivate = bag.personal?.private ?? false;
    const coffeeId = isPrivate ? this.privateCoffee(bag, roasterId) : this.poolCoffee(bag, index, roasterId);
    if (!isPrivate && bag.harvest !== null) {
      this.db
        .prepare('INSERT OR IGNORE INTO coffee_harvest (coffee_id, harvest) VALUES (?, ?)')
        .run(coffeeId, bag.harvest);
    }
    const grinderId = bag.brew.grinder === null ? null : this.grinder(bag.brew.grinder);
    const { plan, personal } = bag;
    const water = bag.brew.water;
    const alt = bag.brew.water_alt ?? null;
    const values: Record<string, SQLInputValue> = {
      account_id: this.accountId,
      coffee_id: coffeeId,
      harvest: bag.harvest,
      lot: bag.lot,
      roast_degree: bag.roast.degree,
      roast_degree_printed: bag.roast.printed,
      roast_degree_assumed: bool(bag.roast.assumed),
      roast_date: bag.roast_date.date,
      roast_date_printed: bag.roast_date.printed,
      roast_date_status: bag.roast_date.status,
      weight_g: bag.weight.grams,
      weight_assumed: bool(bag.weight.assumed),
      price_cents: personal?.price?.cents ?? null,
      currency: personal?.price?.currency ?? null,
      bought_on: personal?.bought_on ?? null,
      shop: personal?.shop ?? null,
      state: personal?.state ?? 'sealed',
      rest_from: plan?.rest.from ?? null,
      rest_to: plan?.rest.to ?? null,
      peak_from: plan?.peak.from ?? null,
      peak_to: plan?.peak.to ?? null,
      portion_from: plan?.portion.from ?? null,
      portion_to: plan?.portion.to ?? null,
      mid_peak: plan?.mid_peak ?? null,
      tube_count: plan?.tubes ?? null,
      dial_in_g: plan?.dial_in_g ?? null,
      water_gh: water?.gh ?? null,
      water_kh: water?.kh ?? null,
      water_ca: water?.ca ?? null,
      water_mg: water?.mg ?? null,
      water_na: water?.na ?? null,
      water_k: water?.k ?? null,
      water_tds: water?.tds ?? null,
      water_alt_gh: alt?.gh ?? null,
      water_alt_kh: alt?.kh ?? null,
      water_alt_ca: alt?.ca ?? null,
      water_alt_mg: alt?.mg ?? null,
      water_alt_na: alt?.na ?? null,
      water_alt_k: alt?.k ?? null,
      water_alt_tds: alt?.tds ?? null,
      kettle_c: bag.brew.kettle_c,
      grinder_id: grinderId,
      grind: bag.brew.grind,
      rating: personal?.rating ?? null,
      rebuy: bool(personal?.rebuy),
      note: personal?.note ?? null,
      source: 'json',
      import_payload: JSON.stringify(bag),
    };
    const columns = Object.keys(values);
    const row = this.db
      .prepare(`INSERT INTO bag (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING id`)
      .get(...Object.values(values));
    return Number(row?.id);
  }

  private privateCoffee(bag: ContractBag, roasterId: number): number {
    const existing = this.db
      .prepare('SELECT id FROM coffee WHERE owner_account_id = ? AND roaster_id = ? AND name_key = ?')
      .get(this.accountId, roasterId, coffeeNameKey(bag.coffee.name));
    return existing === undefined ? this.createCoffee(bag, roasterId, this.accountId) : Number(existing.id);
  }

  private poolCoffee(bag: ContractBag, index: number, roasterId: number): number {
    const existing = this.db
      .prepare('SELECT * FROM coffee WHERE owner_account_id IS NULL AND roaster_id = ? AND name_key = ?')
      .get(roasterId, coffeeNameKey(bag.coffee.name));
    if (existing === undefined) return this.createCoffee(bag, roasterId, null);
    const coffeeId = Number(existing.id);

    for (const [column, read] of scalarFacts) {
      this.compare(index, coffeeId, column, existing[column] as string | number | null, read(bag.coffee));
    }
    const decaf = bag.coffee.decaf ? 1 : 0;
    if (Number(existing.decaf) !== decaf) {
      this.differences.push({
        index,
        field: 'decaf',
        pool: String(existing.decaf === 1),
        yours: String(bag.coffee.decaf),
      });
    }
    this.compareList(index, coffeeId, 'varieties', 'coffee_variety', 'name', bag.coffee.varieties);
    this.compareList(index, coffeeId, 'tasting_notes', 'coffee_tasting_note', 'note', bag.coffee.tasting_notes);
    return coffeeId;
  }

  /** Fills a gap in a pool coffee and logs it, or records a value that differs. Never overwrites. */
  private compare(
    index: number,
    coffeeId: number,
    field: string,
    pool: string | number | null,
    yours: string | number | null,
  ) {
    if (yours === null || pool === yours) return;
    if (pool === null) {
      this.db.prepare(`UPDATE coffee SET ${field} = ? WHERE id = ?`).run(yours, coffeeId);
      this.logEdit(coffeeId, field, null, String(yours));
    } else {
      this.differences.push({ index, field, pool: String(pool), yours: String(yours) });
    }
  }

  private compareList(index: number, coffeeId: number, field: string, table: string, column: string, yours: string[]) {
    const pool = this.db
      .prepare(`SELECT ${column} AS value FROM ${table} WHERE coffee_id = ? ORDER BY position`)
      .all(coffeeId)
      .map((row) => String(row.value));
    if (yours.length === 0 || JSON.stringify(pool) === JSON.stringify(yours)) return;
    if (pool.length === 0) {
      this.insertList(coffeeId, table, column, yours);
      this.logEdit(coffeeId, field, null, JSON.stringify(yours));
    } else {
      this.differences.push({ index, field, pool: JSON.stringify(pool), yours: JSON.stringify(yours) });
    }
  }

  private logEdit(coffeeId: number, field: string, oldValue: string | null, newValue: string) {
    this.db
      .prepare(
        `INSERT INTO coffee_edit (coffee_id, account_id, field, old_value, new_value, edited_on)
         VALUES (?, ?, ?, ?, ?, date('now'))`,
      )
      .run(coffeeId, this.accountId, field, oldValue, newValue);
  }

  private createCoffee(bag: ContractBag, roasterId: number, ownerAccountId: number | null): number {
    const c = bag.coffee;
    const row = this.db
      .prepare(
        `INSERT INTO coffee (owner_account_id, roaster_id, name, name_key, country, region, farm, producer,
           process_printed, process_category, altitude_printed, altitude_min_m, altitude_max_m, decaf)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        ownerAccountId,
        roasterId,
        c.name,
        coffeeNameKey(c.name),
        c.country,
        c.region,
        c.farm,
        c.producer,
        c.process.printed,
        c.process.category,
        c.altitude.printed,
        c.altitude.min_m,
        c.altitude.max_m,
        c.decaf ? 1 : 0,
      );
    const coffeeId = Number(row?.id);
    this.insertList(coffeeId, 'coffee_variety', 'name', c.varieties);
    this.insertList(coffeeId, 'coffee_tasting_note', 'note', c.tasting_notes);
    return coffeeId;
  }

  private insertList(coffeeId: number, table: string, column: string, values: string[]) {
    const insert = this.db.prepare(`INSERT INTO ${table} (coffee_id, position, ${column}) VALUES (?, ?, ?)`);
    values.forEach((value, position) => {
      insert.run(coffeeId, position, value);
    });
  }
}
