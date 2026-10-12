import type { DatabaseSync } from 'node:sqlite';
import type { ContractBag } from '../contract/bag-json.js';
import { exportBags } from './export.js';

type Cell = string | number | boolean | null | undefined;

/** The columns, in order: a header and how each bag fills it. Lists are joined with "; ". */
const columns: [header: string, read: (bag: ContractBag) => Cell][] = [
  ['roaster', (b) => b.roaster.name],
  ['coffee', (b) => b.coffee.name],
  ['country', (b) => b.coffee.country],
  ['region', (b) => b.coffee.region],
  ['farm', (b) => b.coffee.farm],
  ['producer', (b) => b.coffee.producer],
  ['varieties', (b) => b.coffee.varieties.join('; ')],
  ['process', (b) => b.coffee.process.category],
  ['process_printed', (b) => b.coffee.process.printed],
  ['altitude_printed', (b) => b.coffee.altitude.printed],
  ['altitude_min_m', (b) => b.coffee.altitude.min_m],
  ['altitude_max_m', (b) => b.coffee.altitude.max_m],
  ['tasting_notes', (b) => b.coffee.tasting_notes.join('; ')],
  ['decaf', (b) => b.coffee.decaf],
  ['harvest', (b) => b.harvest],
  ['lot', (b) => b.lot],
  ['roast_degree', (b) => b.roast.degree],
  ['roast_degree_assumed', (b) => b.roast.assumed],
  ['roast_date', (b) => b.roast_date.date],
  ['roast_date_printed', (b) => b.roast_date.printed],
  ['roast_date_status', (b) => b.roast_date.status],
  ['weight_g', (b) => b.weight.grams],
  ['weight_assumed', (b) => b.weight.assumed],
  ['rest_from', (b) => b.plan?.rest.from],
  ['rest_to', (b) => b.plan?.rest.to],
  ['peak_from', (b) => b.plan?.peak.from],
  ['peak_to', (b) => b.plan?.peak.to],
  ['portion_from', (b) => b.plan?.portion.from],
  ['portion_to', (b) => b.plan?.portion.to],
  ['mid_peak', (b) => b.plan?.mid_peak],
  ['tubes', (b) => b.plan?.tubes],
  ['dial_in_g', (b) => b.plan?.dial_in_g],
  ['water_gh', (b) => b.brew.water?.gh],
  ['water_kh', (b) => b.brew.water?.kh],
  ['water_ca', (b) => b.brew.water?.ca],
  ['water_mg', (b) => b.brew.water?.mg],
  ['water_na', (b) => b.brew.water?.na],
  ['water_k', (b) => b.brew.water?.k],
  ['water_tds', (b) => b.brew.water?.tds],
  ['water_alt_gh', (b) => b.brew.water_alt?.gh],
  ['water_alt_kh', (b) => b.brew.water_alt?.kh],
  ['water_alt_ca', (b) => b.brew.water_alt?.ca],
  ['water_alt_mg', (b) => b.brew.water_alt?.mg],
  ['water_alt_na', (b) => b.brew.water_alt?.na],
  ['water_alt_k', (b) => b.brew.water_alt?.k],
  ['water_alt_tds', (b) => b.brew.water_alt?.tds],
  ['kettle_c', (b) => b.brew.kettle_c],
  ['grinder', (b) => b.brew.grinder],
  ['grind', (b) => b.brew.grind],
  ['private', (b) => b.personal?.private],
  ['state', (b) => b.personal?.state],
  ['rating', (b) => b.personal?.rating],
  ['rebuy', (b) => b.personal?.rebuy],
  ['note', (b) => b.personal?.note],
  ['bought_on', (b) => b.personal?.bought_on],
  ['price', (b) => (b.personal?.price ? (b.personal.price.cents / 100).toFixed(2) : null)],
  ['currency', (b) => b.personal?.price?.currency],
  ['shop', (b) => b.personal?.shop],
];

/**
 * One account's bags as CSV, one row per bag, for a spreadsheet: RFC 4180 quoting, CRLF line ends, and a byte-order
 * mark so spreadsheet apps read it as UTF-8. It is for reading, not for importing back; the JSON export is the backup.
 * Text that a spreadsheet would run as a formula (starting with =, +, -, @, a tab or a carriage return) gets a
 * leading apostrophe, as OWASP advises against CSV injection. Numbers are written as they are.
 */
export function exportCsv(db: DatabaseSync, accountId: number): string {
  const rows = [
    columns.map(([header]) => header),
    ...exportBags(db, accountId).bags.map((bag) => columns.map(([, read]) => cell(read(bag)))),
  ];
  return `﻿${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`;
}

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
