import type { DatabaseSync } from 'node:sqlite';
import { roasterNameKey } from './name-key.js';

export interface Roaster {
  id: number;
  name: string;
  slug: string;
  source: 'every_coffee' | 'admin';
}

/**
 * Adds a roaster every.coffee lacks. Its slug starts with `admin:`, which every.coffee slugs never contain, so the
 * weekly import can't overwrite it.
 */
export function addRoaster(db: DatabaseSync, enteredName: string): Roaster {
  const name = enteredName.replace(/\s+/g, ' ').trim();
  const nameKey = roasterNameKey(name);
  if (nameKey === '')
    throw new Error(`The roaster name ${JSON.stringify(enteredName)} needs at least one letter or digit.`);

  const base = `admin:${nameKey.replace(/ /g, '-')}`;
  const taken = db.prepare('SELECT 1 FROM roaster WHERE slug = ?');
  let slug = base;
  for (let n = 2; taken.get(slug) !== undefined; n++) slug = `${base}-${n}`;

  const row = db
    .prepare(
      "INSERT INTO roaster (name, name_key, slug, source) VALUES (?, ?, ?, 'admin') RETURNING id, name, slug, source",
    )
    .get(name, nameKey, slug);
  return toRoaster(row);
}

/** The roasters an entered name could mean, by name key or alias, in id order. */
export function findRoasters(db: DatabaseSync, enteredName: string): Roaster[] {
  const key = roasterNameKey(enteredName);
  return db
    .prepare(
      `SELECT id, name, slug, source FROM roaster
       WHERE name_key = ?1 OR id IN (SELECT roaster_id FROM roaster_alias WHERE alias_key = ?1)
       ORDER BY id`,
    )
    .all(key)
    .map(toRoaster);
}

function toRoaster(row: Record<string, unknown> | undefined): Roaster {
  if (row === undefined) throw new Error('Expected a roaster row');
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    source: row.source === 'admin' ? 'admin' : 'every_coffee',
  };
}
