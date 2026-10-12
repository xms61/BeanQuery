import type { DatabaseSync } from 'node:sqlite';
import { roasterNameKey } from '../roaster/name-key.js';

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
