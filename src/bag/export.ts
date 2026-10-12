import type { DatabaseSync } from 'node:sqlite';
import type { BagsDocument } from '../contract/bag-json.js';

type ContractBag = BagsDocument['bags'][number];
type Row = Record<string, unknown>;

const text = (value: unknown) => (value === null ? null : String(value));
const num = (value: unknown) => (value === null ? null : Number(value));
const flag = (value: unknown) => (value === null ? null : value === 1);

/**
 * Writes all of one account's bags, grinders and roaster notes in the bag JSON contract, with every bag's `personal`
 * block filled and each roaster's slug, so the file imports back into any account. Leaves out app bookkeeping: ids,
 * `source` and the raw import payload.
 */
export function exportBags(db: DatabaseSync, accountId: number): BagsDocument {
  const bags = contractBags(db, accountId, null);

  const roasterNotes = db
    .prepare(
      `SELECT r.name, r.slug, n.note FROM roaster_note n JOIN roaster r ON r.id = n.roaster_id
       WHERE n.account_id = ? ORDER BY r.id`,
    )
    .all(accountId)
    .map((row) => ({ roaster: { name: String(row.name), slug: String(row.slug) }, note: String(row.note) }));

  const grinders = db
    .prepare('SELECT name, note FROM grinder WHERE account_id = ? ORDER BY id')
    .all(accountId)
    .map((row) => ({ name: String(row.name), note: text(row.note) }));

  return { schema: 'beanquery.bags/v1', bags, roaster_notes: roasterNotes, grinders };
}

/** One own bag in the contract's shape, `personal` block filled, or undefined when the account has no such bag. */
export function readBag(db: DatabaseSync, accountId: number, bagId: number): ContractBag | undefined {
  return contractBags(db, accountId, bagId)[0];
}

/** The account's bags, or only the one with `bagId`, in id order. */
function contractBags(db: DatabaseSync, accountId: number, bagId: number | null): ContractBag[] {
  const listOf = (table: string, column: string) => {
    const query = db.prepare(`SELECT ${column} AS value FROM ${table} WHERE coffee_id = ? ORDER BY position`);
    return (coffeeId: number) => query.all(coffeeId).map((row) => String(row.value));
  };
  const varieties = listOf('coffee_variety', 'name');
  const tastingNotes = listOf('coffee_tasting_note', 'note');

  return db
    .prepare(
      `SELECT b.*, c.owner_account_id, c.name AS coffee_name, c.country, c.region, c.farm, c.producer,
         c.process_printed, c.process_category, c.altitude_printed, c.altitude_min_m, c.altitude_max_m, c.decaf,
         r.name AS roaster_name, r.slug AS roaster_slug, g.name AS grinder_name
       FROM bag b
       JOIN coffee c ON c.id = b.coffee_id
       JOIN roaster r ON r.id = c.roaster_id
       LEFT JOIN grinder g ON g.account_id = b.account_id AND g.id = b.grinder_id
       WHERE b.account_id = ?1 AND (?2 IS NULL OR b.id = ?2)
       ORDER BY b.id`,
    )
    .all(accountId, bagId)
    .map((row) => toContractBag(row, varieties(Number(row.coffee_id)), tastingNotes(Number(row.coffee_id))));
}

function water(row: Row, prefix: string) {
  if (row[`${prefix}_gh`] === null) return null;
  return {
    gh: Number(row[`${prefix}_gh`]),
    kh: Number(row[`${prefix}_kh`]),
    ca: num(row[`${prefix}_ca`]),
    mg: num(row[`${prefix}_mg`]),
    na: num(row[`${prefix}_na`]),
    k: num(row[`${prefix}_k`]),
    tds: num(row[`${prefix}_tds`]),
  };
}

function toContractBag(row: Row, varieties: string[], tastingNotes: string[]): ContractBag {
  const hasPlan = row.rest_from !== null;
  return {
    roaster: { name: String(row.roaster_name), slug: String(row.roaster_slug) },
    coffee: {
      name: String(row.coffee_name),
      country: text(row.country),
      region: text(row.region),
      farm: text(row.farm),
      producer: text(row.producer),
      varieties,
      process: {
        printed: text(row.process_printed),
        category: text(row.process_category) as ContractBag['coffee']['process']['category'],
      },
      altitude: {
        printed: text(row.altitude_printed),
        min_m: num(row.altitude_min_m),
        max_m: num(row.altitude_max_m),
      },
      tasting_notes: tastingNotes,
      decaf: row.decaf === 1,
    },
    harvest: text(row.harvest),
    lot: text(row.lot),
    roast: {
      degree: text(row.roast_degree) as ContractBag['roast']['degree'],
      assumed: row.roast_degree_assumed === 1,
      printed: text(row.roast_degree_printed),
    },
    roast_date: {
      printed: text(row.roast_date_printed),
      date: text(row.roast_date),
      status: String(row.roast_date_status) as ContractBag['roast_date']['status'],
    },
    weight: { grams: num(row.weight_g), assumed: row.weight_assumed === 1 },
    plan: hasPlan
      ? {
          rest: { from: Number(row.rest_from), to: Number(row.rest_to) },
          peak: { from: Number(row.peak_from), to: Number(row.peak_to) },
          portion: { from: Number(row.portion_from), to: Number(row.portion_to) },
          mid_peak: Number(row.mid_peak),
          tubes: Number(row.tube_count),
          dial_in_g: Number(row.dial_in_g),
        }
      : null,
    brew: {
      water: water(row, 'water'),
      water_alt: water(row, 'water_alt'),
      kettle_c: num(row.kettle_c),
      grinder: text(row.grinder_name),
      grind: text(row.grind),
    },
    personal: {
      private: row.owner_account_id !== null,
      state: String(row.state) as NonNullable<ContractBag['personal']>['state'],
      rating: num(row.rating),
      rebuy: flag(row.rebuy),
      note: text(row.note),
      bought_on: text(row.bought_on),
      price: row.price_cents === null ? null : { cents: Number(row.price_cents), currency: String(row.currency) },
      shop: text(row.shop),
    },
  };
}
