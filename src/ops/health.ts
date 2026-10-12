import type { DatabaseSync } from 'node:sqlite';

/** Runs a trivial query, for the health check that Docker and the deploy checks call. Throws if the database fails. */
export function pingDatabase(db: DatabaseSync): void {
  db.prepare('SELECT 1').get();
}
