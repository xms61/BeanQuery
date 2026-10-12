import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../db.js';
import { migrate } from './migrate.js';

/** A migrated in-memory database with one roaster, two accounts, and a grinder and a private coffee for account 1. */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  db.exec(`
    INSERT INTO roaster (id, name, name_key, slug, source) VALUES (1, 'Sey', 'sey', 'sey', 'every_coffee');
    INSERT INTO account (id, key_hash, is_admin, created_on, last_seen_on) VALUES
      (1, randomblob(32), 1, '2026-10-12', '2026-10-12'),
      (2, randomblob(32), 0, '2026-10-12', '2026-10-12');
    INSERT INTO coffee (id, owner_account_id, roaster_id, name, name_key, decaf) VALUES
      (10, NULL, 1, 'Gatomboya', 'gatomboya', 0),
      (11, 1, 1, 'Secret Lot', 'secret lot', 0);
    INSERT INTO grinder (id, account_id, name) VALUES (20, 1, 'Fellow Ode Gen 2');
  `);
  return db;
}

const insertBag = (db: DatabaseSync, accountId: number, coffeeId: number, grinderId: number | null = null) =>
  Number(
    db
      .prepare(
        `INSERT INTO bag (account_id, coffee_id, grinder_id, roast_date_status, weight_assumed, roast_degree_assumed,
          state, source) VALUES (?, ?, ?, 'verified', 0, 0, 'sealed', 'json') RETURNING id`,
      )
      .get(accountId, coffeeId, grinderId)?.id,
  );

describe('schema', () => {
  test('creates every table of the data model', () => {
    const db = seeded();
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((row) => row.name)).toEqual([
      'account',
      'bag',
      'coffee',
      'coffee_edit',
      'coffee_harvest',
      'coffee_rating',
      'coffee_tasting_note',
      'coffee_variety',
      'grinder',
      'invite',
      'roaster',
      'roaster_alias',
      'roaster_note',
      'schema_migration',
      'session',
    ]);
    const notStrict = db.prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND strict = 0").all();
    expect(notStrict.map((row) => row.name).filter((name) => !String(name).startsWith('sqlite_'))).toEqual([]);
    db.close();
  });

  test('the pool tables have no column for plan, brew, rating, price, date or other personal data', () => {
    const db = seeded();
    const personal =
      /rest|peak|portion|tube|dial|water|kettle|grind|rating|price|currency|bought|shop|state|note$|_on$|_at$|date|account/;
    for (const table of ['roaster', 'coffee', 'coffee_harvest', 'coffee_variety', 'coffee_tasting_note']) {
      const columns = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
      // owner_account_id marks a private coffee, and a tasting note is the roaster's, not the user's.
      const allowed = ['coffee.owner_account_id', 'coffee_tasting_note.note'];
      const leaked = columns
        .map((row) => String(row.name))
        .filter((name) => personal.test(name) && !allowed.includes(`${table}.${name}`));
      expect({ table, leaked }).toEqual({ table, leaked: [] });
    }
    db.close();
  });

  describe('enums and ranges', () => {
    test.each([
      ['coffee process', "UPDATE coffee SET process_category = 'wet-hulled' WHERE id = 10"],
      ['coffee decaf', 'UPDATE coffee SET decaf = 2 WHERE id = 10'],
      ['coffee altitude', 'UPDATE coffee SET altitude_min_m = 2000, altitude_max_m = 1800 WHERE id = 10'],
      ['bag state', "UPDATE bag SET state = 'opened'"],
      ['bag roast degree', "UPDATE bag SET roast_degree = 'cinnamon'"],
      ['bag roast date status', "UPDATE bag SET roast_date_status = 'unknown'"],
      ['bag roast date', "UPDATE bag SET roast_date = '2026-02-30'"],
      ['bag source', "UPDATE bag SET source = 'photo'"],
      ['bag rating above 5', 'UPDATE bag SET rating = 5.5'],
      ['bag rating off the half steps', 'UPDATE bag SET rating = 3.3'],
      ['bag weight', 'UPDATE bag SET weight_g = 0'],
      ['bag kettle', 'UPDATE bag SET kettle_c = 101'],
      ['bag water without kh', 'UPDATE bag SET water_gh = 50'],
      ['bag ions without gh and kh', 'UPDATE bag SET water_ca = 20'],
      ['bag price without currency', 'UPDATE bag SET price_cents = 1800'],
      ['bag currency', "UPDATE bag SET price_cents = 1800, currency = 'eur'"],
      ['bag half a plan', 'UPDATE bag SET rest_from = 0, rest_to = 7'],
      [
        'bag plan window backwards',
        `UPDATE bag SET rest_from = 7, rest_to = 0, peak_from = 7, peak_to = 21, portion_from = 7, portion_to = 7,
         mid_peak = 14, tube_count = 10, dial_in_g = 50`,
      ],
      [
        'bag mid-peak outside the peak',
        `UPDATE bag SET rest_from = 0, rest_to = 7, peak_from = 7, peak_to = 21, portion_from = 7, portion_to = 7,
         mid_peak = 30, tube_count = 10, dial_in_g = 50`,
      ],
      ['bag boolean', 'UPDATE bag SET rebuy = 3'],
      ['account date', "UPDATE account SET created_on = '12 Oct 2026'"],
      ['account admin flag', 'UPDATE account SET is_admin = 2'],
      ['account key hash length', 'UPDATE account SET key_hash = randomblob(16) WHERE id = 2'],
      ['rating band', "INSERT INTO coffee_rating (coffee_id, rating_rounded, account_band) VALUES (10, 4, '2+')"],
      ['rating rounded', "INSERT INTO coffee_rating (coffee_id, rating_rounded, account_band) VALUES (10, 4.2, '3+')"],
    ])('rejects a bad %s', (_, sql) => {
      const db = seeded();
      insertBag(db, 1, 10);
      expect(() => db.exec(sql)).toThrow(/CHECK constraint failed|cannot store/);
      db.close();
    });

    test('accepts a full, valid bag', () => {
      const db = seeded();
      insertBag(db, 1, 10, 20);
      expect(() =>
        db.exec(`UPDATE bag SET roast_degree = 'light', roast_degree_printed = 'Light roast for filter', roast_date = '2026-09-18', weight_g = 250, rating = 4.5,
          rebuy = 1, kettle_c = 94, water_gh = 50, water_kh = 20, water_ca = 30, water_mg = 20, water_na = 0,
          water_k = 20, water_tds = 80, price_cents = 1800, currency = 'EUR', bought_on = '2026-09-20',
          rest_from = 0, rest_to = 7, peak_from = 7, peak_to = 21, portion_from = 7, portion_to = 7, mid_peak = 14,
          tube_count = 10, dial_in_g = 50`),
      ).not.toThrow();
      db.close();
    });
  });

  describe('coffee uniqueness', () => {
    test('allows one pool coffee per roaster and name key, whatever the harvest', () => {
      const db = seeded();
      db.exec("INSERT INTO coffee_harvest (coffee_id, harvest) VALUES (10, '2024/25'), (10, '2025/26')");

      expect(() =>
        db.exec("INSERT INTO coffee (roaster_id, name, name_key, decaf) VALUES (1, 'GATOMBOYA', 'gatomboya', 0)"),
      ).toThrow(/UNIQUE constraint failed/);
      expect(() => db.exec("INSERT INTO coffee_harvest (coffee_id, harvest) VALUES (10, '2025/26')")).toThrow(
        /UNIQUE constraint failed/,
      );
      db.close();
    });

    test('allows one private coffee per account, roaster and name key, beside a pool coffee of that name', () => {
      const db = seeded();
      const insert = db.prepare(
        "INSERT INTO coffee (owner_account_id, roaster_id, name, name_key, decaf) VALUES (?, 1, 'Gatomboya', 'gatomboya', 0)",
      );
      insert.run(1);
      insert.run(2);

      expect(() => insert.run(1)).toThrow(/UNIQUE constraint failed/);
      db.close();
    });
  });

  describe('account boundaries', () => {
    test("a bag can point at a pool coffee or its own account's private coffee", () => {
      const db = seeded();
      expect(insertBag(db, 1, 10)).toBeDefined();
      expect(insertBag(db, 2, 10)).toBeDefined();
      expect(insertBag(db, 1, 11, 20)).toBeDefined();
      db.close();
    });

    test("a bag can't point at another account's private coffee, on insert or update", () => {
      const db = seeded();
      expect(() => insertBag(db, 2, 11)).toThrow(/another account's private coffee/);

      const bagId = insertBag(db, 2, 10);
      expect(() => db.prepare('UPDATE bag SET coffee_id = 11 WHERE id = ?').run(bagId)).toThrow(
        /another account's private coffee/,
      );
      db.close();
    });

    test("a coffee can't become private to one account while another account's bag uses it", () => {
      const db = seeded();
      insertBag(db, 2, 10);

      expect(() => db.exec('UPDATE coffee SET owner_account_id = 1 WHERE id = 10')).toThrow(
        /another account's private coffee/,
      );
      db.close();
    });

    test("a bag can't use another account's grinder", () => {
      const db = seeded();
      expect(() => insertBag(db, 2, 10, 20)).toThrow(/FOREIGN KEY constraint failed/);
      db.close();
    });

    test('a grinder that bags use cannot be deleted', () => {
      const db = seeded();
      insertBag(db, 1, 10, 20);
      expect(() => db.exec('DELETE FROM grinder WHERE id = 20')).toThrow(/FOREIGN KEY constraint failed/);
      db.close();
    });

    test('a coffee that bags use cannot be deleted', () => {
      const db = seeded();
      insertBag(db, 2, 10);
      expect(() => db.exec('DELETE FROM coffee WHERE id = 10')).toThrow(/FOREIGN KEY constraint failed/);
      db.close();
    });

    test('deleting an account removes its rows and keeps its pool edits without the account', () => {
      const db = seeded();
      insertBag(db, 1, 10, 20);
      insertBag(db, 1, 11, 20);
      insertBag(db, 2, 10);
      db.exec(`
        INSERT INTO roaster_note (account_id, roaster_id, note) VALUES (1, 1, 'Good filter roasts');
        INSERT INTO session (token_hash, account_id, expires_at) VALUES (randomblob(32), 1, '2027-01-10T12:00:00Z');
        INSERT INTO coffee_edit (coffee_id, account_id, field, old_value, new_value, edited_on)
          VALUES (10, 1, 'region', NULL, 'Kirinyaga', '2026-10-12');
      `);

      db.exec('DELETE FROM account WHERE id = 1');

      const count = (sql: string) => db.prepare(sql).get()?.n;
      expect(count('SELECT count(*) AS n FROM bag WHERE account_id = 1')).toBe(0);
      expect(count('SELECT count(*) AS n FROM coffee WHERE owner_account_id = 1')).toBe(0);
      expect(count('SELECT count(*) AS n FROM grinder')).toBe(0);
      expect(count('SELECT count(*) AS n FROM roaster_note')).toBe(0);
      expect(count('SELECT count(*) AS n FROM session')).toBe(0);
      expect(count('SELECT count(*) AS n FROM bag')).toBe(1);
      expect(db.prepare('SELECT coffee_id, account_id FROM coffee_edit').all()).toEqual([
        { coffee_id: 10, account_id: null },
      ]);
      db.close();
    });
  });
});
