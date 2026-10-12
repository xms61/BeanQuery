import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { exportLimits, parseBagsJson } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { exportBags } from './export.js';
import { importBags } from './import.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);

function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  return db;
}

/**
 * 60 bags built from the five real ones: 30 coffees with two bags each (bags i and i + 5), with personal data. Bag 7 is
 * private, while its sibling bag 2 publishes the same coffee to the pool.
 */
function sixtyBags() {
  const bags = Array.from({ length: 60 }, (_, i) => {
    const bag = structuredClone(fixture.bags[i % 5]);
    bag.coffee.name = `${bag.coffee.name} ${Math.floor(i / 10)}`;
    bag.harvest = i % 2 === 0 ? '2025/26' : null;
    // Covers the null shapes: a bag typed in without a plan, and one with no alternative water.
    if (i === 10) bag.plan = null;
    if (i === 11) delete bag.brew.water_alt;
    bag.personal = {
      private: i === 7,
      state: (['sealed', 'open', 'frozen', 'finished'] as const)[i % 4],
      rating: i % 3 === 0 ? (i % 11) / 2 : null,
      rebuy: i % 3 === 1 ? i % 2 === 0 : null,
      note: i % 5 === 0 ? `Note ${i}` : null,
      bought_on: '2026-09-20',
      frozen_on: i % 4 === 2 ? '2026-10-14' : null,
      price: i % 4 === 0 ? { cents: 1500 + i, currency: 'EUR' } : null,
      shop: null,
    };
    return bag;
  });
  return {
    schema: 'beanquery.bags/v1',
    bags,
    roaster_notes: [{ roaster: { name: 'Tanat', slug: 'tanat-coffee' }, note: 'Valveless bags' }],
    grinders: [{ name: 'Fellow Ode Gen 2', note: 'Stock burrs, zeroed at chirp' }],
  };
}

describe('exportBags', () => {
  test('exports every field of the contract, and the export validates', () => {
    const db = seeded();
    importBags(db, 1, JSON.stringify(fixture), { limits: exportLimits });

    const exported = exportBags(db, 1);
    expect(parseBagsJson(JSON.stringify(exported), exportLimits)).toMatchObject({ ok: true });
    expect(exported.bags[2]).toEqual({
      ...fixture.bags[2],
      roaster: { name: 'Tanat', slug: 'tanat-coffee' },
      personal: {
        private: false,
        state: 'sealed',
        rating: null,
        rebuy: null,
        note: null,
        bought_on: null,
        frozen_on: null,
        price: null,
        shop: null,
      },
    });
    db.close();
  });

  test('exports only the account’s own bags, grinders and notes', () => {
    const db = seeded();
    importBags(db, 1, JSON.stringify(sixtyBags()), { limits: exportLimits });
    expect(exportBags(db, 2)).toEqual({ schema: 'beanquery.bags/v1', bags: [], roaster_notes: [], grinders: [] });
    db.close();
  });

  test('60 bags exported and imported into an empty account come back with the same values, private bean included', () => {
    const db = seeded();
    const original = sixtyBags();
    expect(importBags(db, 1, JSON.stringify(original), { limits: exportLimits })).toMatchObject({ status: 'saved' });
    const poolCoffees = Number(db.prepare('SELECT count(*) AS n FROM coffee WHERE owner_account_id IS NULL').get()?.n);

    const exported = exportBags(db, 1);
    expect(importBags(db, 2, JSON.stringify(exported), { limits: exportLimits })).toMatchObject({
      status: 'saved',
      differences: [],
    });
    const reexported = exportBags(db, 2);

    // Against the input, so a field lost on import shows up here and not only as two equally wrong exports.
    const registry: Record<string, { name: string; slug: string }> = {
      'Nord Kaffe': { name: 'Nord Kaffe', slug: 'nord-kaffe' },
      TANAT: { name: 'Tanat', slug: 'tanat-coffee' },
    };
    expect(exported.bags).toEqual(
      original.bags.map((bag) => ({
        ...bag,
        roaster: registry[bag.roaster.name],
        brew: { water_alt: null, ...bag.brew },
      })),
    );
    expect(reexported).toEqual(exported);
    expect(reexported.bags).toHaveLength(60);
    expect(reexported.bags.filter((bag) => bag.personal?.private)).toHaveLength(1);
    expect(Number(db.prepare('SELECT count(*) AS n FROM coffee WHERE owner_account_id IS NULL').get()?.n)).toBe(
      poolCoffees,
    );
    expect(
      db.prepare('SELECT owner_account_id FROM coffee WHERE owner_account_id IS NOT NULL ORDER BY 1').all(),
    ).toEqual([{ owner_account_id: 1 }, { owner_account_id: 2 }]);
    db.close();
  });
});
