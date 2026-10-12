import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { exportCsv } from './csv.js';
import { importBags } from './import.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

function seeded(change: (document: typeof fixture) => void = () => {}): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  const document = structuredClone(fixture);
  change(document);
  importBags(db, 1, JSON.stringify(document), { limits: pasteLimits });
  return db;
}

/** Splits CSV text into rows of cells, by RFC 4180, so a test reads what a spreadsheet would. */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\r' && csv[i + 1] === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      i++;
    } else value += char;
  }
  return rows;
}

describe('exportCsv', () => {
  test('writes a header and one row per bag of the account, with a UTF-8 byte-order mark and CRLF lines', () => {
    const db = seeded();
    const csv = exportCsv(db, 1);
    expect(csv.startsWith('﻿roaster,coffee,country,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const [header, ...rows] = parse(csv.slice(1));
    expect(rows).toHaveLength(5);
    const first = Object.fromEntries((header ?? []).map((name, i) => [name, rows[0]?.[i]]));
    expect(first).toMatchObject({
      roaster: 'Nord Kaffe',
      coffee: 'Ethiopia Sasaba',
      tasting_notes: 'Pineapple; Bergamot; Peach',
      roast_date: '2026-09-18',
      peak_to: '30',
      water_gh: '60',
      farm: '',
      private: 'false',
      state: 'sealed',
    });
    expect(parse(exportCsv(db, 2).slice(1))).toHaveLength(1);
    db.close();
  });

  test('quotes commas, quotes and line breaks, and defuses text a spreadsheet would run as a formula', () => {
    const db = seeded((document) => {
      document.bags[0].personal = {
        note: 'Bright, "juicy"\nthen flat',
        shop: '=HYPERLINK("https://evil.example","click")',
        price: { cents: 1390, currency: 'EUR' },
      };
      document.bags[0].lot = '-2+3';
    });
    const csv = exportCsv(db, 1);
    expect(csv).toContain('"Bright, ""juicy""\nthen flat"');
    const [header, row] = parse(csv.slice(1));
    const cells = Object.fromEntries((header ?? []).map((name, i) => [name, row?.[i]]));
    expect(cells).toMatchObject({
      note: 'Bright, "juicy"\nthen flat',
      shop: `'=HYPERLINK("https://evil.example","click")`,
      lot: "'-2+3",
      price: '13.90',
      currency: 'EUR',
    });
    db.close();
  });
});
