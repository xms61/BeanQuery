import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../db.js';
import { type CommandIo, roasterImportCommand } from './command.js';

const page = [
  '<a href="/roaster/sey"><span>Sey</span></a>',
  '<a href="/roaster/black-white"><span>Black &amp; White</span></a>',
  '<footer><a href="/roaster/sey">Sey Coffee</a></footer>',
].join('');

/** Records what the command does, with in-memory databases by path and a fake every.coffee. */
function fakeIo(site: Record<string, Response> = {}, files: Record<string, string> = {}) {
  const databases = new Map<string, DatabaseSync>();
  const out: string[] = [];
  const err: string[] = [];
  const requests: string[] = [];
  const io: CommandIo = {
    openDatabase: (path) => {
      const db = databases.get(path) ?? openDatabase(':memory:');
      databases.set(path, db);
      return db;
    },
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    fetchFn: async (url) => {
      requests.push(url);
      return site[new URL(url).pathname] ?? new Response('not found', { status: 404 });
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  return { io, databases, out, err, requests };
}

function rowsOf(db: DatabaseSync | undefined) {
  if (db === undefined) throw new Error('The command opened no database');
  return {
    roasters: db.prepare('SELECT name, name_key, slug, source FROM roaster ORDER BY slug').all(),
    aliases: db
      .prepare('SELECT alias_key, slug FROM roaster_alias JOIN roaster ON roaster.id = roaster_id ORDER BY 1, 2')
      .all(),
  };
}

describe('roasterImportCommand', () => {
  test('uploading a saved copy gives the same rows as the live run', async () => {
    const live = fakeIo({ '/robots.txt': new Response('User-agent: *\nAllow: /'), '/roasters': new Response(page) });
    const upload = fakeIo({}, { 'saved.html': page });

    expect(await roasterImportCommand(['--db', 'live.db'], live.io)).toBe(0);
    expect(await roasterImportCommand(['--db', 'upload.db', '--file', 'saved.html'], upload.io)).toBe(0);

    expect(upload.requests).toEqual([]);
    expect(rowsOf(live.databases.get('live.db'))).toEqual(rowsOf(upload.databases.get('upload.db')));
    expect(rowsOf(live.databases.get('live.db')).roasters).toHaveLength(2);
    expect(live.out).toEqual([
      '{"event":"roaster_import","from":"fetch","added":2,"renamed":0,"unchanged":0,"notListed":0}',
    ]);
    expect(upload.out).toEqual([
      '{"event":"roaster_import","from":"file","added":2,"renamed":0,"unchanged":0,"notListed":0}',
    ]);
  });

  test('a refusal exits with 2, says to upload a saved copy, and opens no database', async () => {
    const refused = fakeIo({ '/robots.txt': new Response('Forbidden', { status: 403 }) });

    expect(await roasterImportCommand(['--db', 'live.db'], refused.io)).toBe(2);
    expect(refused.requests).toHaveLength(1);
    expect(refused.err.join('\n')).toMatch(/403.*upload a saved copy/s);
    expect(refused.databases.size).toBe(0);
  });

  test('without --db it prints the usage and exits with 1', async () => {
    const { io, err, requests } = fakeIo();

    expect(await roasterImportCommand([], io)).toBe(1);
    expect(err).toEqual([expect.stringMatching(/^Usage: pnpm roasters:import --db/)]);
    expect(requests).toEqual([]);
  });

  test('an unknown option prints the usage and exits with 1', async () => {
    const { io, err } = fakeIo();

    expect(await roasterImportCommand(['--db', 'x.db', '--fiel', 'saved.html'], io)).toBe(1);
    expect(err.join('\n')).toMatch(/--fiel.*Usage/s);
  });
});
