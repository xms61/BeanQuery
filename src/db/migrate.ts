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
