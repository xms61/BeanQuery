import type { DatabaseSync } from 'node:sqlite';
import { worldMap } from './world-map.data.js';
import { type MapCountry, nameKey } from './world-map-build.js';

/**
 * One account's statistics over its own bags, private ones included, and nothing of other accounts': where its
 * coffees come from, what the beans are, and what it paid. A rating average counts only rated bags.
 */

export interface Tally {
  /** What is counted: a country, a variety, a roaster and so on. */
  label: string;
  bags: number;
  rated: number;
  /** The average rating of the rated bags, to one decimal; null with none rated. */
  rating: number | null;
}

export interface CountryTally extends Tally {
  /** The map country it matched, or null for a name no map country has. */
  mapId: string | null;
}

export interface AltitudeTally extends Tally {
  /** The band's lower edge in metres: a bag counts by the middle of its altitude range. */
  from: number;
}

export interface MonthSpend {
  /** YYYY-MM, from the date the bag was bought. */
  month: string;
  currency: string;
  bags: number;
  cents: number;
  /** The price per 100 g in cents, over the bags with a weight; null when none has one. */
  per100g: number | null;
}

export interface AccountStats {
  bags: number;
  countries: CountryTally[];
  /** Bag countries no map country matched, as written on the bags. */
  unmatched: string[];
  regions: (Tally & { country: string })[];
  altitudes: AltitudeTally[];
  /** Bags without an altitude. */
  noAltitude: number;
  varieties: Tally[];
  processes: Tally[];
  roasts: Tally[];
  roasters: Tally[];
  spending: MonthSpend[];
  /** Bags with a price but no date bought, left out of `spending`. */
  pricedUndated: number;
}

/** The altitude bands' width in metres. */
export const altitudeStep = 200;

/** Common ways to write a coffee country that Natural Earth's names don't cover, by map id. */
const aliases: Record<string, string[]> = {
  COD: ['drc', 'dr congo', 'congo drc', 'democratic republic of congo', 'congo kinshasa', 'kivu'],
  CIV: ['ivory coast'],
  USA: ['usa', 'us', 'united states', 'hawaii', 'kona'],
  TLS: ['east timor', 'timor'],
  MMR: ['burma'],
  VNM: ['viet nam'],
  PNG: ['png'],
  IDN: ['sumatra', 'java', 'sulawesi', 'bali', 'flores', 'aceh'],
  ECU: ['galapagos'],
  GBR: ['uk'],
};

const countryByKey = (() => {
  const byKey = new Map<string, MapCountry>();
  for (const country of worldMap.countries) {
    for (const key of country.keys) if (!byKey.has(key)) byKey.set(key, country);
  }
  for (const [id, keys] of Object.entries(aliases)) {
    const country = worldMap.countries.find((c) => c.id === id);
    if (country === undefined) throw new Error(`The map has no country ${id} for its aliases`);
    for (const key of keys) byKey.set(key, country);
  }
  return byKey;
})();

/**
 * The map countries a bag's free-text country names: the whole text if it is one country, else each part of a blend
 * written as "Brazil, Ethiopia" or "Kenya / Rwanda". Parts no country matches come back as written.
 */
export function matchCountries(text: string): { matched: MapCountry[]; unmatched: string[] } {
  const whole = countryByKey.get(nameKey(text));
  if (whole !== undefined) return { matched: [whole], unmatched: [] };
  const parts = text
    .split(/[,/&+;]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const matched: MapCountry[] = [];
  const unmatched: string[] = [];
  for (const part of parts) {
    const country = countryByKey.get(nameKey(part));
    if (country === undefined) unmatched.push(part);
    else if (!matched.includes(country)) matched.push(country);
  }
  return { matched, unmatched };
}

interface BagRow {
  country: string | null;
  region: string | null;
  varieties: string | null;
  process: string | null;
  roast: string | null;
  altitudeMin: number | null;
  altitudeMax: number | null;
  roaster: string;
  rating: number | null;
  cents: number | null;
  currency: string | null;
  grams: number | null;
  boughtOn: string | null;
}

export function accountStats(db: DatabaseSync, accountId: number): AccountStats {
  const rows = db
    .prepare(
      `SELECT c.country, c.region, c.process_category AS process, b.roast_degree AS roast,
         c.altitude_min_m AS altitudeMin, c.altitude_max_m AS altitudeMax, r.name AS roaster, b.rating,
         b.price_cents AS cents, b.currency, b.weight_g AS grams, b.bought_on AS boughtOn,
         (SELECT group_concat(name, '|') FROM (SELECT name FROM coffee_variety WHERE coffee_id = c.id ORDER BY position))
           AS varieties
       FROM bag b JOIN coffee c ON c.id = b.coffee_id JOIN roaster r ON r.id = c.roaster_id
       WHERE b.account_id = ?`,
    )
    .all(accountId) as unknown as BagRow[];

  const countries = new Tallies<CountryTally>();
  const unmatched = new Set<string>();
  const regions = new Tallies<Tally & { country: string }>();
  const altitudes = new Tallies<AltitudeTally>();
  const varieties = new Tallies<Tally>();
  const processes = new Tallies<Tally>();
  const roasts = new Tallies<Tally>();
  const roasters = new Tallies<Tally>();
  let noAltitude = 0;

  for (const row of rows) {
    const country = row.country?.trim() ?? '';
    const match = country === '' ? { matched: [], unmatched: [] } : matchCountries(country);
    for (const mapCountry of match.matched) {
      countries.add(mapCountry.id, row.rating, { label: mapCountry.name, mapId: mapCountry.id });
    }
    for (const name of match.unmatched) {
      unmatched.add(name);
      countries.add(`?${nameKey(name)}`, row.rating, { label: name, mapId: null });
    }
    const region = row.region?.trim() ?? '';
    if (region !== '') {
      const countryLabel = match.matched.length === 1 ? (match.matched[0] as MapCountry).name : country;
      regions.add(`${nameKey(countryLabel)}|${nameKey(region)}`, row.rating, { label: region, country: countryLabel });
    }
    if (row.altitudeMin !== null && row.altitudeMax !== null) {
      const from = Math.floor((row.altitudeMin + row.altitudeMax) / 2 / altitudeStep) * altitudeStep;
      altitudes.add(String(from), row.rating, { label: `${from} to ${from + altitudeStep} m`, from });
    } else {
      noAltitude++;
    }
    for (const variety of new Set((row.varieties ?? '').split('|').filter((v) => v.trim() !== ''))) {
      varieties.add(nameKey(variety), row.rating, { label: variety.trim() });
    }
    if (row.process !== null) processes.add(row.process, row.rating, { label: row.process });
    if (row.roast !== null) roasts.add(row.roast, row.rating, { label: row.roast });
    roasters.add(row.roaster, row.rating, { label: row.roaster });
  }

  return {
    bags: rows.length,
    countries: countries.ranked(),
    unmatched: [...unmatched].sort((a, b) => a.localeCompare(b)),
    regions: regions.ranked(),
    altitudes: altitudes.all().sort((a, b) => a.from - b.from),
    noAltitude,
    varieties: varieties.ranked(),
    processes: processes.ranked(),
    roasts: roasts.all().sort((a, b) => roastOrder.indexOf(a.label) - roastOrder.indexOf(b.label)),
    roasters: roasters.ranked(),
    spending: spending(rows),
    pricedUndated: rows.filter((row) => row.cents !== null && row.currency !== null && row.boughtOn === null).length,
  };
}

const roastOrder = ['light', 'light-medium', 'medium', 'medium-dark', 'dark'];

/** Counts bags by a key, with the sum of their ratings for the average. */
class Tallies<T extends Tally> {
  private readonly byKey = new Map<string, { tally: T; sum: number }>();

  add(key: string, rating: number | null, fields: Omit<T, 'bags' | 'rated' | 'rating'>): void {
    let entry = this.byKey.get(key);
    if (entry === undefined) {
      entry = { tally: { ...fields, bags: 0, rated: 0, rating: null } as T, sum: 0 };
      this.byKey.set(key, entry);
    }
    entry.tally.bags++;
    if (rating !== null) {
      entry.tally.rated++;
      entry.sum += rating;
      entry.tally.rating = Math.round((entry.sum / entry.tally.rated) * 10) / 10;
    }
  }

  all(): T[] {
    return [...this.byKey.values()].map((entry) => entry.tally);
  }

  /** Most bags first, then the better rating, then by name. */
  ranked(): T[] {
    return this.all().sort(
      (a, b) => b.bags - a.bags || (b.rating ?? -1) - (a.rating ?? -1) || a.label.localeCompare(b.label),
    );
  }
}

function spending(rows: BagRow[]): MonthSpend[] {
  const byMonth = new Map<string, MonthSpend & { pricedCents: number; grams: number }>();
  for (const row of rows) {
    if (row.cents === null || row.currency === null || row.boughtOn === null) continue;
    const month = row.boughtOn.slice(0, 7);
    const key = `${month}|${row.currency}`;
    let entry = byMonth.get(key);
    if (entry === undefined) {
      entry = { month, currency: row.currency, bags: 0, cents: 0, per100g: null, pricedCents: 0, grams: 0 };
      byMonth.set(key, entry);
    }
    entry.bags++;
    entry.cents += row.cents;
    if (row.grams !== null) {
      entry.pricedCents += row.cents;
      entry.grams += row.grams;
      entry.per100g = Math.round((entry.pricedCents / entry.grams) * 100);
    }
  }
  return [...byMonth.values()]
    .map(({ pricedCents: _cents, grams: _grams, ...spend }) => spend)
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}
