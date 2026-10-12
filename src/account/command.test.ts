import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../db.js';
import { signIn } from './account.js';
import { adminCommand } from './command.js';

function fakeIo() {
  const db = openDatabase(':memory:');
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    openDatabase: (_path: string): DatabaseSync => db,
    now: () => new Date('2026-10-12T12:00:00Z'),
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
  };
  return { db, io, out, err };
}

describe('adminCommand', () => {
  test('create-admin makes an admin on an empty database and prints its number once, with a warning', async () => {
    const { db, io, out } = fakeIo();
    expect(await adminCommand(['create-admin', '--db', 'beans.db'], io)).toBe(0);
    const number = /([0-9A-Z]{4}( [0-9A-Z]{4}){4})/.exec(out.join('\n'))?.[1] as string;
    expect(out.join('\n')).toMatch(/shown only now/);
    expect(signIn(db, number, io.now())).toMatchObject({ status: 'signed_in' });
    expect(db.prepare('SELECT is_admin FROM account').all()).toEqual([{ is_admin: 1 }]);
  });

  test('create-admin on a database that already has accounts needs --another, for when the owner lost theirs', async () => {
    const { db, io, err } = fakeIo();
    await adminCommand(['create-admin', '--db', 'beans.db'], io);
    expect(await adminCommand(['create-admin', '--db', 'beans.db'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/--another/);
    expect(await adminCommand(['create-admin', '--another', '--db', 'beans.db'], io)).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM account WHERE is_admin = 1').get()).toEqual({ n: 2 });
  });

  test('create-invite prints a code and its expiry date', async () => {
    const { db, io, out } = fakeIo();
    expect(await adminCommand(['create-invite', '--db', 'beans.db'], io)).toBe(0);
    expect(out.join('\n')).toMatch(/[0-9A-Z]{4} [0-9A-Z]{4} [0-9A-Z]{4}.*2026-10-26/s);
    expect(db.prepare('SELECT count(*) AS n FROM invite').get()).toEqual({ n: 1 });
  });

  test('anything else prints the usage and exits with 1', async () => {
    const { io, err } = fakeIo();
    expect(await adminCommand(['make-me-admin', '--db', 'beans.db'], io)).toBe(1);
    expect(await adminCommand(['create-invite'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/Usage: pnpm admin/);
  });
});
