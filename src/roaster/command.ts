import type { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { migrate } from '../db/migrate.js';
import { type FetchFn, fetchRoasterPage, RoasterFetchRefused } from './fetch.js';
import { importRoasters } from './import.js';
import { parseRoasterList } from './parse.js';

const usage = 'Usage: pnpm roasters:import --db <database file> [--file <saved copy of every.coffee/roasters>]';

/** What the command touches outside itself, so tests can run it on in-memory databases and a fake site. */
export interface CommandIo {
  /** Opens the database at a path. The caller closes it. */
  openDatabase(path: string): DatabaseSync;
  readFile(path: string): string;
  fetchFn: FetchFn;
  log(line: string): void;
  error(line: string): void;
}

/**
 * `pnpm roasters:import`: fetches every.coffee/roasters, or reads a saved copy given with `--file`, and imports it.
 * Exits with 1 on bad arguments and 2 when every.coffee refuses.
 */
export async function roasterImportCommand(argv: readonly string[], io: CommandIo): Promise<number> {
  let options: { db?: string | undefined; file?: string | undefined };
  try {
    options = parseArgs({ args: [...argv], options: { db: { type: 'string' }, file: { type: 'string' } } }).values;
  } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 1;
  }
  if (options.db === undefined) {
    io.error(usage);
    return 1;
  }

  let html: string;
  try {
    html = options.file === undefined ? await fetchRoasterPage(io.fetchFn) : io.readFile(options.file);
  } catch (error) {
    if (!(error instanceof RoasterFetchRefused)) throw error;
    io.error(error.message);
    return 2;
  }

  const db = io.openDatabase(options.db);
  migrate(db);
  const summary = importRoasters(db, parseRoasterList(html));
  io.log(JSON.stringify({ event: 'roaster_import', from: options.file === undefined ? 'fetch' : 'file', ...summary }));
  return 0;
}
