import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Applied in order, each once. Never edit a migration that has shipped: add a new one,
 * because databases that already ran it will not run it again.
 */
const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'roaster registry',
    sql: `
      CREATE TABLE roaster (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL CHECK (source IN ('every_coffee', 'admin'))
      ) STRICT;
      CREATE INDEX roaster_name_key ON roaster (name_key);

      CREATE TABLE roaster_alias (
        alias_key TEXT NOT NULL,
        roaster_id INTEGER NOT NULL REFERENCES roaster (id) ON DELETE CASCADE,
        PRIMARY KEY (alias_key, roaster_id)
      ) STRICT;
      CREATE INDEX roaster_alias_roaster_id ON roaster_alias (roaster_id);
    `,
  },
  {
    id: 2,
    name: 'accounts, coffees and bags',
    // Booleans are 0 or 1, dates are YYYY-MM-DD (checked by round-tripping through date()), and hashes are SHA-256.
    sql: `
      CREATE TABLE account (
        id INTEGER PRIMARY KEY,
        key_hash BLOB NOT NULL UNIQUE CHECK (length(key_hash) = 32),
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        created_on TEXT NOT NULL CHECK (created_on IS date(created_on)),
        last_seen_on TEXT NOT NULL CHECK (last_seen_on IS date(last_seen_on))
      ) STRICT;

      CREATE TABLE invite (
        code_hash BLOB PRIMARY KEY CHECK (length(code_hash) = 32),
        expires_on TEXT NOT NULL CHECK (expires_on IS date(expires_on))
      ) STRICT;

      CREATE TABLE session (
        token_hash BLOB PRIMARY KEY CHECK (length(token_hash) = 32),
        account_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL CHECK (expires_at IS strftime('%Y-%m-%dT%H:%M:%SZ', expires_at))
      ) STRICT;
      CREATE INDEX session_account_id ON session (account_id);

      -- A coffee with no owner_account_id is in the pool; one with an owner is private to that account.
      CREATE TABLE coffee (
        id INTEGER PRIMARY KEY,
        owner_account_id INTEGER REFERENCES account (id) ON DELETE CASCADE,
        roaster_id INTEGER NOT NULL REFERENCES roaster (id),
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        country TEXT,
        region TEXT,
        farm TEXT,
        producer TEXT,
        process_printed TEXT,
        process_category TEXT CHECK (process_category IN ('washed', 'natural', 'honey', 'anaerobic', 'other')),
        altitude_printed TEXT,
        altitude_min_m INTEGER CHECK (altitude_min_m >= 0),
        altitude_max_m INTEGER CHECK (altitude_max_m >= altitude_min_m),
        decaf INTEGER NOT NULL CHECK (decaf IN (0, 1))
      ) STRICT;
      CREATE UNIQUE INDEX coffee_pool_name ON coffee (roaster_id, name_key) WHERE owner_account_id IS NULL;
      CREATE UNIQUE INDEX coffee_private_name ON coffee (owner_account_id, roaster_id, name_key)
        WHERE owner_account_id IS NOT NULL;

      CREATE TABLE coffee_harvest (
        coffee_id INTEGER NOT NULL REFERENCES coffee (id) ON DELETE CASCADE,
        harvest TEXT NOT NULL,
        PRIMARY KEY (coffee_id, harvest)
      ) STRICT;

      CREATE TABLE coffee_variety (
        coffee_id INTEGER NOT NULL REFERENCES coffee (id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        name TEXT NOT NULL,
        PRIMARY KEY (coffee_id, position)
      ) STRICT;
      CREATE INDEX coffee_variety_name ON coffee_variety (name);

      CREATE TABLE coffee_tasting_note (
        coffee_id INTEGER NOT NULL REFERENCES coffee (id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        note TEXT NOT NULL,
        PRIMARY KEY (coffee_id, position)
      ) STRICT;

      CREATE TABLE coffee_edit (
        id INTEGER PRIMARY KEY,
        coffee_id INTEGER NOT NULL REFERENCES coffee (id) ON DELETE CASCADE,
        account_id INTEGER REFERENCES account (id) ON DELETE SET NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        edited_on TEXT NOT NULL CHECK (edited_on IS date(edited_on))
      ) STRICT;
      CREATE INDEX coffee_edit_coffee_id ON coffee_edit (coffee_id);
      CREATE INDEX coffee_edit_account_id ON coffee_edit (account_id);

      -- Rebuilt in full once a day. No row means fewer than 3 accounts rated the coffee.
      CREATE TABLE coffee_rating (
        coffee_id INTEGER PRIMARY KEY REFERENCES coffee (id) ON DELETE CASCADE,
        rating_rounded REAL NOT NULL
          CHECK (rating_rounded BETWEEN 0 AND 5 AND rating_rounded * 2 = round(rating_rounded * 2)),
        account_band TEXT NOT NULL CHECK (account_band IN ('3+', '10+', '50+'))
      ) STRICT;

      CREATE TABLE roaster_note (
        account_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
        roaster_id INTEGER NOT NULL REFERENCES roaster (id),
        note TEXT NOT NULL,
        PRIMARY KEY (account_id, roaster_id)
      ) STRICT;

      CREATE TABLE grinder (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        note TEXT,
        UNIQUE (account_id, id)
      ) STRICT;

      CREATE TABLE bag (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
        coffee_id INTEGER NOT NULL REFERENCES coffee (id) ON DELETE RESTRICT,
        harvest TEXT,
        lot TEXT,

        roast_degree TEXT CHECK (roast_degree IN ('light', 'light-medium', 'medium', 'medium-dark', 'dark')),
        roast_degree_printed TEXT,
        roast_degree_assumed INTEGER NOT NULL CHECK (roast_degree_assumed IN (0, 1)),
        roast_date TEXT CHECK (roast_date IS date(roast_date)),
        roast_date_printed TEXT,
        roast_date_status TEXT NOT NULL
          CHECK (roast_date_status IN ('verified', 'ambiguous', 'missing', 'unlabelled', 'future')),

        weight_g INTEGER CHECK (weight_g > 0),
        weight_assumed INTEGER NOT NULL CHECK (weight_assumed IN (0, 1)),

        price_cents INTEGER CHECK (price_cents >= 0),
        currency TEXT CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
        bought_on TEXT CHECK (bought_on IS date(bought_on)),
        shop TEXT,
        state TEXT NOT NULL DEFAULT 'sealed' CHECK (state IN ('sealed', 'open', 'frozen', 'finished')),

        rest_from INTEGER CHECK (rest_from >= 0),
        rest_to INTEGER CHECK (rest_to >= rest_from),
        peak_from INTEGER CHECK (peak_from >= 0),
        peak_to INTEGER CHECK (peak_to >= peak_from),
        portion_from INTEGER CHECK (portion_from >= 0),
        portion_to INTEGER CHECK (portion_to >= portion_from),
        mid_peak INTEGER CHECK (mid_peak BETWEEN peak_from AND peak_to),
        tube_count INTEGER CHECK (tube_count >= 0),
        dial_in_g INTEGER CHECK (dial_in_g >= 0),
        mid_peak_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (mid_peak_dismissed IN (0, 1)),

        water_gh REAL CHECK (water_gh >= 0),
        water_kh REAL CHECK (water_kh >= 0),
        water_ca REAL CHECK (water_ca >= 0),
        water_mg REAL CHECK (water_mg >= 0),
        water_na REAL CHECK (water_na >= 0),
        water_k REAL CHECK (water_k >= 0),
        water_tds REAL CHECK (water_tds >= 0),

        kettle_c INTEGER CHECK (kettle_c BETWEEN 70 AND 100),
        grinder_id INTEGER,
        grind TEXT,

        rating REAL CHECK (rating BETWEEN 0 AND 5 AND rating * 2 = round(rating * 2)),
        rebuy INTEGER CHECK (rebuy IN (0, 1)),
        note TEXT,

        source TEXT NOT NULL CHECK (source IN ('json', 'manual')),
        import_payload TEXT,

        -- A plan is whole or absent, water needs both GH and KH, and a price needs its currency.
        CHECK ((rest_from IS NULL) + (rest_to IS NULL) + (peak_from IS NULL) + (peak_to IS NULL)
          + (portion_from IS NULL) + (portion_to IS NULL) + (mid_peak IS NULL) + (tube_count IS NULL)
          + (dial_in_g IS NULL) IN (0, 9)),
        CHECK ((water_gh IS NULL) = (water_kh IS NULL)),
        CHECK (water_gh IS NOT NULL OR coalesce(water_ca, water_mg, water_na, water_k, water_tds) IS NULL),
        CHECK ((price_cents IS NULL) = (currency IS NULL)),
        -- Composite, so a bag can only use a grinder of its own account. Deleting a used grinder is refused rather
        -- than set to null, because SET NULL would also null account_id.
        FOREIGN KEY (account_id, grinder_id) REFERENCES grinder (account_id, id)
      ) STRICT;
      CREATE INDEX bag_account_id ON bag (account_id, grinder_id);
      CREATE INDEX bag_coffee_id ON bag (coffee_id);

      CREATE TRIGGER bag_coffee_owner_insert BEFORE INSERT ON bag
      WHEN coalesce((SELECT owner_account_id FROM coffee WHERE id = NEW.coffee_id), NEW.account_id) != NEW.account_id
      BEGIN
        SELECT RAISE(ABORT, 'bag.coffee_id points at another account''s private coffee');
      END;

      CREATE TRIGGER bag_coffee_owner_update BEFORE UPDATE OF account_id, coffee_id ON bag
      WHEN coalesce((SELECT owner_account_id FROM coffee WHERE id = NEW.coffee_id), NEW.account_id) != NEW.account_id
      BEGIN
        SELECT RAISE(ABORT, 'bag.coffee_id points at another account''s private coffee');
      END;

      CREATE TRIGGER coffee_owner_update BEFORE UPDATE OF owner_account_id ON coffee
      WHEN NEW.owner_account_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM bag WHERE coffee_id = NEW.id AND account_id != NEW.owner_account_id)
      BEGIN
        SELECT RAISE(ABORT, 'coffee would become another account''s private coffee for a bag that uses it');
      END;
    `,
  },
  {
    id: 3,
    name: 'alternative water',
    // ALTER TABLE can't add table constraints, so each column's CHECK carries the rule: an alternative water needs a
    // main water, and needs both GH and KH, like the main one.
    sql: `
      -- Each check starts with IS NULL OR, because NULL AND FALSE is FALSE, which would reject a bag with no water.
      ALTER TABLE bag ADD COLUMN water_alt_gh REAL
        CHECK (water_alt_gh IS NULL OR (water_alt_gh >= 0 AND water_gh IS NOT NULL));
      ALTER TABLE bag ADD COLUMN water_alt_kh REAL
        CHECK ((water_alt_kh IS NULL) = (water_alt_gh IS NULL) AND (water_alt_kh IS NULL OR water_alt_kh >= 0));
      ALTER TABLE bag ADD COLUMN water_alt_ca REAL
        CHECK (water_alt_ca IS NULL OR (water_alt_ca >= 0 AND water_alt_gh IS NOT NULL));
      ALTER TABLE bag ADD COLUMN water_alt_mg REAL
        CHECK (water_alt_mg IS NULL OR (water_alt_mg >= 0 AND water_alt_gh IS NOT NULL));
      ALTER TABLE bag ADD COLUMN water_alt_na REAL
        CHECK (water_alt_na IS NULL OR (water_alt_na >= 0 AND water_alt_gh IS NOT NULL));
      ALTER TABLE bag ADD COLUMN water_alt_k REAL
        CHECK (water_alt_k IS NULL OR (water_alt_k >= 0 AND water_alt_gh IS NOT NULL));
      ALTER TABLE bag ADD COLUMN water_alt_tds REAL
        CHECK (water_alt_tds IS NULL OR (water_alt_tds >= 0 AND water_alt_gh IS NOT NULL));
    `,
  },
  {
    id: 4,
    name: 'rating date',
    // The day the rating was last set, so the collective rating can take each account's latest rated bag.
    sql: `
      ALTER TABLE bag ADD COLUMN rated_on TEXT
        CHECK (rated_on IS date(rated_on) AND (rated_on IS NULL OR rating IS NOT NULL));
    `,
  },
];

/** Brings the schema up to date. Safe to run on every start: applied migrations are skipped. */
export function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_on TEXT NOT NULL
  ) STRICT`);

  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migration')
      .all()
      .map((row) => row.id),
  );
  const record = db.prepare("INSERT INTO schema_migration (id, name, applied_on) VALUES (?, ?, date('now'))");

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      record.run(migration.id, migration.name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.id} (${migration.name}) failed and was rolled back`, { cause: error });
    }
  }
}
