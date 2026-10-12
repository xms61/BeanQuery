import type { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { migrate } from '../db/migrate.js';
import { createInvite } from './account.js';
import { createAdmin } from './bootstrap.js';

const usage = `Usage: pnpm admin <command> --db <database file>
  create-admin [--another]  Make an admin account and print its number once. --another adds one to a database that
                            already has accounts, for when the owner has lost theirs.
  create-invite             Make an invite code, valid 14 days.`;

export interface AdminIo {
  /** Opens the database at a path. The caller closes it. */
  openDatabase(path: string): DatabaseSync;
  now(): Date;
  log(line: string): void;
  error(line: string): void;
}

/** `pnpm admin`: the server command, run over SSH, for what no web route may do. */
export async function adminCommand(argv: readonly string[], io: AdminIo): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command] = positionals;
  if (
    values.db === undefined ||
    positionals.length !== 1 ||
    !['create-admin', 'create-invite'].includes(command ?? '')
  ) {
    io.error(usage);
    return 1;
  }

  const db = io.openDatabase(values.db);
  migrate(db);
  if (command === 'create-admin') {
    const accounts = Number(db.prepare('SELECT count(*) AS n FROM account').get()?.n);
    if (accounts > 0 && !values.another) {
      io.error(`This database already has ${accounts} accounts. Add --another to make one more admin.`);
      return 1;
    }
    const { accountNumber } = createAdmin(db, io.now());
    io.log(`Admin account number: ${accountNumber}`);
    io.log('It is shown only now and stored only as a hash. Save it somewhere safe; nobody can recover it.');
    return 0;
  }
  const { code, expiresOn } = createInvite(db, io.now());
  io.log(`Invite code: ${code}`);
  io.log(`Valid until ${expiresOn}. Send it however you like; it works once.`);
  return 0;
}

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { db: { type: 'string' }, another: { type: 'boolean' } },
  });
