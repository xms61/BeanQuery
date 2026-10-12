import type { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { rebuildCollectiveRatings } from '../coffee/rating.js';
import { migrate } from '../db/migrate.js';
import { backupDatabase, restoreDatabase } from './backup.js';

const usage = `Usage: pnpm ops <command> --db <database file>
  backup --dir <folder> [--keep <n>]  Copy the database into the folder while the app runs, and keep the newest n
                                      backups (14 unless given).
  restore --from <backup file>        Put a backup in place of the database. Stop the app first. The replaced file
                                      is kept beside it.
  rebuild-ratings                     Rebuild every pool coffee's collective rating, as the nightly job does.`;

export interface OpsIo {
  /** Opens the database at a path. The caller closes it. */
  openDatabase(path: string): DatabaseSync;
  now(): Date;
  log(line: string): void;
  error(line: string): void;
}

/** `pnpm ops`: the server's jobs and the restore, run by the systemd timers or by hand over SSH. */
export async function opsCommand(argv: readonly string[], io: OpsIo): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command] = positionals;
  const keep = values.keep === undefined ? 14 : Number(values.keep);
  const valid =
    values.db !== undefined &&
    positionals.length === 1 &&
    ((command === 'backup' && values.dir !== undefined && Number.isInteger(keep) && keep >= 1) ||
      (command === 'restore' && values.from !== undefined) ||
      command === 'rebuild-ratings');
  if (!valid || values.db === undefined) {
    io.error(usage);
    return 1;
  }

  try {
    if (command === 'restore') {
      const { replaced } = restoreDatabase(values.from as string, values.db, io.now());
      io.log(`Restored ${values.from} to ${values.db}.`);
      io.log(replaced === null ? 'There was no database there before.' : `The replaced database is at ${replaced}.`);
      return 0;
    }
    const db = io.openDatabase(values.db);
    if (command === 'backup') {
      const { file, removed } = await backupDatabase(db, values.dir as string, io.now(), keep);
      io.log(`Backed up to ${file}.${removed.length > 0 ? ` Removed ${removed.length} older.` : ''}`);
      return 0;
    }
    migrate(db);
    const { rated } = rebuildCollectiveRatings(db);
    io.log(`Rebuilt the collective ratings: ${rated} coffees rated.`);
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      dir: { type: 'string' },
      keep: { type: 'string' },
      from: { type: 'string' },
    },
  });
