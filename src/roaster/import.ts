import type { DatabaseSync } from 'node:sqlite';
import { roasterNameKey } from './name-key.js';
import type { RoasterListing } from './parse.js';

export interface ImportSummary {
  added: number;
  renamed: number;
  unchanged: number;
  /** every.coffee roasters in the database but not in this list. They stay, because bags may use them. */
  notListed: number;
}

/**
 * Upserts every.coffee's roasters by slug in one transaction, so a renamed roaster keeps its id. Never deletes a
 * roaster, and never touches the ones the admin added. Expects one listing per slug, as `parseRoasterList` returns.
 */
export function importRoasters(db: DatabaseSync, listings: readonly RoasterListing[]): ImportSummary {
  const find = db.prepare("SELECT id, name FROM roaster WHERE slug = ? AND source = 'every_coffee'");
  const insert = db.prepare(
    "INSERT INTO roaster (name, name_key, slug, source) VALUES (?, ?, ?, 'every_coffee') RETURNING id",
  );
  const rename = db.prepare('UPDATE roaster SET name = ?, name_key = ? WHERE id = ?');
  const addAlias = db.prepare('INSERT OR IGNORE INTO roaster_alias (alias_key, roaster_id) VALUES (?, ?)');
  const countListed = db.prepare("SELECT count(*) AS total FROM roaster WHERE source = 'every_coffee'");

  const summary: ImportSummary = { added: 0, renamed: 0, unchanged: 0, notListed: 0 };
  db.exec('BEGIN');
  try {
    for (const listing of listings) {
      const nameKey = roasterNameKey(listing.name);
      const existing = find.get(listing.slug);
      let id: number;
      if (existing === undefined) {
        id = Number(insert.get(listing.name, nameKey, listing.slug)?.id);
        summary.added++;
      } else {
        id = Number(existing.id);
        if (existing.name === listing.name) {
          summary.unchanged++;
        } else {
          rename.run(listing.name, nameKey, id);
          summary.renamed++;
        }
      }
      for (const otherName of listing.otherNames) {
        const aliasKey = roasterNameKey(otherName);
        if (aliasKey !== nameKey && aliasKey !== '') addAlias.run(aliasKey, id);
      }
    }
    summary.notListed = Number(countListed.get()?.total) - summary.added - summary.renamed - summary.unchanged;
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return summary;
}
