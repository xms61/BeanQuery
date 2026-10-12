import type { DatabaseSync } from 'node:sqlite';
import type { CoffeeFacts } from '../contract/bag-json.js';
import { roasterNameKey } from '../roaster/name-key.js';
import { readCoffee } from './edit.js';

export interface PoolCoffee {
  coffeeId: number;
  name: string;
  roaster: string;
  roasterSlug: string;
  country: string | null;
  region: string | null;
  process: string | null;
  varieties: string[];
  harvests: string[];
  rating: { value: number; band: string } | null;
  private: boolean;
}

/**
 * The pool, for one account: every pool coffee, plus the account's own private coffees when asked (for "start from
 * the pool"), never another account's. A query matches when each of its words appears in the coffee's name, roaster,
 * country, region or varieties, ignoring case and accents. Sorted by roaster, then coffee.
 */
export function searchPool(
  db: DatabaseSync,
  accountId: number,
  options: { query?: string; includeOwnPrivate?: boolean } = {},
): PoolCoffee[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.name_key, c.country, c.region, c.process_category, c.owner_account_id,
         r.name AS roaster, r.slug, r.name_key AS roaster_key, cr.rating_rounded, cr.account_band,
         (SELECT group_concat(name, '|') FROM (SELECT name FROM coffee_variety WHERE coffee_id = c.id ORDER BY position))
           AS varieties,
         (SELECT group_concat(harvest, '|') FROM (SELECT harvest FROM coffee_harvest WHERE coffee_id = c.id ORDER BY harvest))
           AS harvests
       FROM coffee c
       JOIN roaster r ON r.id = c.roaster_id
       LEFT JOIN coffee_rating cr ON cr.coffee_id = c.id
       WHERE c.owner_account_id IS NULL OR (?1 AND c.owner_account_id = ?2)
       ORDER BY r.name_key, c.name_key, c.id`,
    )
    .all(options.includeOwnPrivate ? 1 : 0, accountId);

  const words = roasterNameKey(options.query ?? '')
    .split(' ')
    .filter(Boolean);
  const list = (value: unknown) => (value === null ? [] : String(value).split('|'));
  return rows
    .map((row) => ({
      row,
      coffee: {
        coffeeId: Number(row.id),
        name: String(row.name),
        roaster: String(row.roaster),
        roasterSlug: String(row.slug),
        country: row.country === null ? null : String(row.country),
        region: row.region === null ? null : String(row.region),
        process: row.process_category === null ? null : String(row.process_category),
        varieties: list(row.varieties),
        harvests: list(row.harvests),
        rating:
          row.rating_rounded === null ? null : { value: Number(row.rating_rounded), band: String(row.account_band) },
        private: row.owner_account_id !== null,
      },
    }))
    .filter(({ row, coffee }) => {
      if (words.length === 0) return true;
      const haystack = new Set(
        roasterNameKey(
          [row.name_key, row.roaster_key, coffee.country, coffee.region, ...coffee.varieties].filter(Boolean).join(' '),
        ).split(' '),
      );
      return words.every((word) => haystack.has(word));
    })
    .map(({ coffee }) => coffee);
}

/**
 * What a new bag started from a coffee begins with: its roaster's name, its facts, and whether it is the account's own
 * private coffee. Undefined for a missing coffee and for another account's private one, alike.
 */
export function startingPoint(
  db: DatabaseSync,
  accountId: number,
  coffeeId: number,
): { roaster: string; coffee: CoffeeFacts; private: boolean } | undefined {
  const row = db
    .prepare(
      `SELECT r.name AS roaster, c.owner_account_id FROM coffee c JOIN roaster r ON r.id = c.roaster_id
       WHERE c.id = ? AND (c.owner_account_id IS NULL OR c.owner_account_id = ?)`,
    )
    .get(coffeeId, accountId);
  const coffee = row === undefined ? undefined : readCoffee(db, coffeeId);
  if (row === undefined || coffee === undefined) return undefined;
  return { roaster: String(row.roaster), coffee, private: row.owner_account_id !== null };
}

export interface PoolFilter {
  query?: string;
  roaster?: string;
  country?: string;
  process?: string;
  variety?: string;
}

/**
 * The pool page: pool coffees only, never a private one, matching the query and the picked roaster, country, process
 * and variety, with the values each of those can take among the query's matches.
 */
export function browsePool(
  db: DatabaseSync,
  accountId: number,
  filter: PoolFilter = {},
): {
  coffees: PoolCoffee[];
  options: { roasters: string[]; countries: string[]; processes: string[]; varieties: string[] };
} {
  const matches = searchPool(db, accountId, filter.query === undefined ? {} : { query: filter.query });
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => v !== null && v !== ''))].sort((a, b) => a.localeCompare(b));
  return {
    coffees: matches.filter(
      (coffee) =>
        (filter.roaster === undefined || coffee.roaster === filter.roaster) &&
        (filter.country === undefined || coffee.country === filter.country) &&
        (filter.process === undefined || coffee.process === filter.process) &&
        (filter.variety === undefined || coffee.varieties.includes(filter.variety)),
    ),
    options: {
      roasters: distinct(matches.map((c) => c.roaster)),
      countries: distinct(matches.map((c) => c.country)),
      processes: distinct(matches.map((c) => c.process)),
      varieties: distinct(matches.flatMap((c) => c.varieties)),
    },
  };
}

export interface CoffeePage {
  coffeeId: number;
  roaster: { id: number; name: string; slug: string; source: 'every_coffee' | 'admin' };
  facts: CoffeeFacts;
  private: boolean;
  harvests: string[];
  rating: { value: number; band: string } | null;
  /** The account's own bags on this coffee, newest roast first. */
  bags: { bagId: number; roastDate: string | null; harvest: string | null; state: string }[];
}

/**
 * A coffee's page: a pool coffee for any account, or the account's own private coffee. Undefined for a missing coffee
 * and for another account's private one, alike. Lists only the account's own bags on it.
 */
export function coffeePage(db: DatabaseSync, accountId: number, coffeeId: number): CoffeePage | undefined {
  const row = db
    .prepare(
      `SELECT c.owner_account_id, r.id AS roaster_id, r.name, r.slug, r.source, cr.rating_rounded, cr.account_band
       FROM coffee c JOIN roaster r ON r.id = c.roaster_id LEFT JOIN coffee_rating cr ON cr.coffee_id = c.id
       WHERE c.id = ? AND (c.owner_account_id IS NULL OR c.owner_account_id = ?)`,
    )
    .get(coffeeId, accountId);
  const facts = row === undefined ? undefined : readCoffee(db, coffeeId);
  if (row === undefined || facts === undefined) return undefined;
  const inPool = row.owner_account_id === null;
  return {
    coffeeId,
    roaster: {
      id: Number(row.roaster_id),
      name: String(row.name),
      slug: String(row.slug),
      source: row.source === 'admin' ? 'admin' : 'every_coffee',
    },
    facts,
    private: !inPool,
    harvests: db
      .prepare('SELECT harvest FROM coffee_harvest WHERE coffee_id = ? ORDER BY harvest')
      .all(coffeeId)
      .map((h) => String(h.harvest)),
    rating:
      inPool && row.rating_rounded !== null
        ? { value: Number(row.rating_rounded), band: String(row.account_band) }
        : null,
    bags: db
      .prepare(
        `SELECT id, roast_date, harvest, state FROM bag WHERE coffee_id = ? AND account_id = ?
         ORDER BY roast_date IS NULL, roast_date DESC, id DESC`,
      )
      .all(coffeeId, accountId)
      .map((b) => ({
        bagId: Number(b.id),
        roastDate: b.roast_date === null ? null : String(b.roast_date),
        harvest: b.harvest === null ? null : String(b.harvest),
        state: String(b.state),
      })),
  };
}
