import type { DatabaseSync } from 'node:sqlite';
import type { ContractBag } from '../contract/bag-json.js';
import { roasterNameKey } from '../roaster/name-key.js';
import { readBag } from './export.js';

export type Phase = 'resting' | 'rested' | 'peak' | 'past' | 'no_roast_date' | 'no_plan';
export type Plan = NonNullable<ContractBag['plan']>;
export type BagState = 'sealed' | 'open' | 'frozen' | 'finished';

export interface LibraryBag {
  bagId: number;
  coffee: string;
  roaster: string;
  country: string | null;
  region: string | null;
  process: string | null;
  varieties: string[];
  roastDate: string | null;
  roastDatePrinted: string | null;
  roastDateStatus: string;
  /** Days since roasting, today being day 0 on the roast date; null without a roast date. */
  day: number | null;
  plan: Plan | null;
  phase: Phase;
  rating: number | null;
  state: BagState;
  private: boolean;
}

export interface LibraryFilter {
  /** `active` is sealed, open or frozen. */
  state?: 'all' | 'active' | 'finished';
  roaster?: string;
  process?: string;
  variety?: string;
  phase?: Phase;
  /** At least this rating, or only bags without one. */
  minRating?: number | 'unrated';
  /** Words that must each appear in the coffee, roaster, country, region or varieties. */
  query?: string;
}

/**
 * Where a bag is in its plan on `today`, a YYYY-MM-DD date in the user's time zone:
 * - `resting` before the rest window opens, `rested` from then until the peak, `peak` inside it, `past` after it;
 * - `no_roast_date` without a roast date, and `no_plan` with a date but no plan.
 */
export function phaseOn(
  roastDate: string | null,
  plan: Plan | null,
  today: string,
): { phase: Phase; day: number | null } {
  if (roastDate === null) return { phase: 'no_roast_date', day: null };
  const day = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${roastDate}T00:00:00Z`)) / 86_400_000);
  if (plan === null) return { phase: 'no_plan', day };
  if (day < plan.rest.from) return { phase: 'resting', day };
  if (day < plan.peak.from) return { phase: 'rested', day };
  if (day <= plan.peak.to) return { phase: 'peak', day };
  return { phase: 'past', day };
}

/**
 * One account's library on `today`: its bags, filtered, unfinished first and newest roast first, with the total
 * before filtering and the roasters, processes and varieties its bags have, for the filter menus.
 */
export function library(
  db: DatabaseSync,
  accountId: number,
  today: string,
  filter: LibraryFilter = {},
): { bags: LibraryBag[]; total: number; options: { roasters: string[]; processes: string[]; varieties: string[] } } {
  const rows = db
    .prepare(
      `SELECT b.id, b.roast_date, b.roast_date_printed, b.roast_date_status, b.rest_from, b.rest_to, b.peak_from,
         b.peak_to, b.portion_from, b.portion_to, b.mid_peak, b.tube_count, b.dial_in_g, b.rating, b.state,
         c.name AS coffee, c.country, c.region, c.process_category, c.owner_account_id, r.name AS roaster,
         (SELECT group_concat(name, '|') FROM (SELECT name FROM coffee_variety WHERE coffee_id = c.id ORDER BY position))
           AS varieties
       FROM bag b JOIN coffee c ON c.id = b.coffee_id JOIN roaster r ON r.id = c.roaster_id
       WHERE b.account_id = ?
       ORDER BY b.state = 'finished', b.roast_date IS NULL, b.roast_date DESC, b.id DESC`,
    )
    .all(accountId);

  const text = (value: unknown) => (value === null ? null : String(value));
  const all: LibraryBag[] = rows.map((row) => {
    const plan: Plan | null =
      row.rest_from === null
        ? null
        : {
            rest: { from: Number(row.rest_from), to: Number(row.rest_to) },
            peak: { from: Number(row.peak_from), to: Number(row.peak_to) },
            portion: { from: Number(row.portion_from), to: Number(row.portion_to) },
            mid_peak: Number(row.mid_peak),
            tubes: Number(row.tube_count),
            dial_in_g: Number(row.dial_in_g),
          };
    const roastDate = text(row.roast_date);
    return {
      bagId: Number(row.id),
      coffee: String(row.coffee),
      roaster: String(row.roaster),
      country: text(row.country),
      region: text(row.region),
      process: text(row.process_category),
      varieties: row.varieties === null ? [] : String(row.varieties).split('|'),
      roastDate,
      roastDatePrinted: text(row.roast_date_printed),
      roastDateStatus: String(row.roast_date_status),
      ...phaseOn(roastDate, plan, today),
      plan,
      rating: row.rating === null ? null : Number(row.rating),
      state: String(row.state) as BagState,
      private: row.owner_account_id !== null,
    };
  });

  const words = roasterNameKey(filter.query ?? '')
    .split(' ')
    .filter(Boolean);
  const bags = all.filter((b) => {
    if (filter.state === 'active' && b.state === 'finished') return false;
    if (filter.state === 'finished' && b.state !== 'finished') return false;
    if (filter.roaster !== undefined && b.roaster !== filter.roaster) return false;
    if (filter.process !== undefined && b.process !== filter.process) return false;
    if (filter.variety !== undefined && !b.varieties.includes(filter.variety)) return false;
    if (filter.phase !== undefined && b.phase !== filter.phase) return false;
    if (filter.minRating === 'unrated' && b.rating !== null) return false;
    if (typeof filter.minRating === 'number' && (b.rating === null || b.rating < filter.minRating)) return false;
    if (words.length > 0) {
      const haystack = roasterNameKey([b.coffee, b.roaster, b.country, b.region, ...b.varieties].join(' '));
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });

  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => v !== null))].sort((a, b) => a.localeCompare(b));
  return {
    bags,
    total: all.length,
    options: {
      roasters: distinct(all.map((b) => b.roaster)),
      processes: distinct(all.map((b) => b.process)),
      varieties: distinct(all.flatMap((b) => b.varieties)),
    },
  };
}

/** One own bag for its page: the contract fields, its phase on `today`, and its coffee's pool status and rating. */
export function bagDetail(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  today: string,
):
  | {
      bagId: number;
      coffeeId: number;
      bag: ContractBag;
      phase: Phase;
      day: number | null;
      inPool: boolean;
      collective: { rating: number; band: string } | null;
    }
  | undefined {
  const bag = readBag(db, accountId, bagId);
  if (bag === undefined) return undefined;
  const row = db
    .prepare(
      `SELECT c.id, c.owner_account_id, cr.rating_rounded, cr.account_band
       FROM bag b JOIN coffee c ON c.id = b.coffee_id LEFT JOIN coffee_rating cr ON cr.coffee_id = c.id
       WHERE b.id = ? AND b.account_id = ?`,
    )
    .get(bagId, accountId);
  const inPool = row?.owner_account_id === null;
  return {
    bagId,
    coffeeId: Number(row?.id),
    bag,
    ...phaseOn(bag.roast_date.date, bag.plan, today),
    inPool,
    // The collective rating belongs to pool coffees only.
    collective:
      inPool && row?.rating_rounded != null
        ? { rating: Number(row.rating_rounded), band: String(row.account_band) }
        : null,
  };
}
