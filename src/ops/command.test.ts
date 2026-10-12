import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { opsCommand } from './command.js';

const folders: string[] = [];
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: DatabaseSync[] = [];
  const io = {
    openDatabase: (path: string) => {
      const db = openDatabase(path);
      opened.push(db);
      return db;
    },
    now: () => new Date('2026-10-12T03:00:00Z'),
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
  };
  return opsCommand(argv, io).then((code) => {
    for (const db of opened) db.close();
    return { code, out, err };
  });
}

function live(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beanquery-ops-'));
  folders.push(dir);
  const db = openDatabase(join(dir, 'live.db'));
  migrate(db);
  db.close();
  return { dir, db: join(dir, 'live.db') };
}

describe('pnpm ops', () => {
  test('backs up into a folder, then restores that backup', async () => {
    const { dir, db } = live();
    const backup = await run(['backup', '--db', db, '--dir', join(dir, 'backups'), '--keep', '3']);
    expect(backup).toEqual({
      code: 0,
      out: [`Backed up to ${join(dir, 'backups', 'beanquery-2026-10-12T030000Z.db')}.`],
      err: [],
    });

    const file = join(dir, 'backups', readdirSync(join(dir, 'backups'))[0] as string);
    const restore = await run(['restore', '--db', db, '--from', file]);
    expect(restore.code).toBe(0);
    expect(restore.out[1]).toBe(`The replaced database is at ${db}.replaced-2026-10-12T030000Z.`);
  });

  test('rebuilds the collective ratings', async () => {
    const { db } = live();
    expect(await run(['rebuild-ratings', '--db', db])).toEqual({
      code: 0,
      out: ['Rebuilt the collective ratings: 0 coffees rated.'],
      err: [],
    });
  });

  test('shows the usage for a missing or unknown command or option, and creates no file', async () => {
    const { dir, db } = live();
    for (const argv of [
      [],
      ['backup', '--db', db],
      ['backup', '--db', db, '--dir', dir, '--keep', '0'],
      ['restore', '--db', db],
      ['vacuum', '--db', db],
      ['rebuild-ratings'],
      ['rebuild-ratings', '--db', db, '--force'],
    ]) {
      const result = await run(argv);
      expect([argv, result.code, result.err.join('\n')]).toEqual([argv, 1, expect.stringContaining('Usage: pnpm ops')]);
    }
    expect(readdirSync(dir)).toEqual(['live.db']);
  });

  test('reports a refused restore as an error, and changes nothing', async () => {
    const { dir, db } = live();
    const result = await run(['restore', '--db', db, '--from', join(dir, 'missing.db')]);
    expect(result).toEqual({ code: 1, out: [], err: [`No backup at ${join(dir, 'missing.db')}.`] });
    expect(existsSync(db)).toBe(true);
  });
});
