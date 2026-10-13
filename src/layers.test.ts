import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * The layer rule: `db → domain → web`. A module may import from its own layer or a lower one, never a higher one.
 * Each top-level part of src/ belongs to exactly one layer; a new folder fails here until it is given one.
 */
const layers: Record<string, 'db' | 'domain' | 'web'> = {
  'db.ts': 'db',
  'db.test.ts': 'db',
  db: 'db',
  account: 'domain',
  admin: 'domain',
  bag: 'domain',
  coffee: 'domain',
  contract: 'domain',
  ops: 'domain',
  roaster: 'domain',
  stats: 'domain',
  web: 'web',
};
const rank = { db: 0, domain: 1, web: 2 };

const src = fileURLToPath(new URL('./', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
const name = (path: string) => relative(src, path).split(sep).join('/');
const layerOf = (path: string) => layers[name(path).split('/')[0] as string];
const imports = (path: string) =>
  [...readFileSync(path, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1] as string);
const sources = files(src).filter((path) => name(path) !== 'layers.test.ts');

describe('the layer rule, db → domain → web', () => {
  test('every part of src/ belongs to a layer', () => {
    const unassigned = sources.filter((path) => layerOf(path) === undefined).map(name);
    expect(unassigned, 'Add each new top-level folder or file of src/ to `layers` in src/layers.test.ts').toEqual([]);
  });

  test('no module imports from a higher layer', () => {
    const broken: string[] = [];
    for (const path of sources) {
      const from = layerOf(path);
      if (from === undefined) continue;
      for (const specifier of imports(path).filter((s) => s.startsWith('.'))) {
        const to = layerOf(resolve(dirname(path), specifier));
        if (to !== undefined && rank[to] > rank[from])
          broken.push(`${name(path)} (${from}) imports ${specifier} (${to})`);
      }
    }
    expect(
      broken,
      'Move the code the lower layer needs down into it, or pass it in as a plain value. The domain never sees a request.',
    ).toEqual([]);
  });

  test('only the web layer imports Hono', () => {
    const broken = sources
      .filter((path) => layerOf(path) !== 'web')
      .filter((path) => imports(path).some((s) => s === 'hono' || s.startsWith('hono/') || s.startsWith('@hono/')))
      .map(name);
    expect(broken, 'Keep HTTP in src/web/; give the domain function plain values and an account id').toEqual([]);
  });

  test('the web layer runs no SQL of its own', () => {
    const broken = sources
      // Tests and their shared setup may seed data directly.
      .filter((path) => layerOf(path) === 'web' && !/(\.test\.tsx?|test-support\.ts)$/.test(path))
      // A statement (`.prepare(`) or a script run on a database (`db.exec(`); a regular expression's `.exec(` is fine.
      .filter((path) => /\.prepare\(|\bdb\.exec\(/.test(readFileSync(path, 'utf8')))
      .map(name);
    expect(broken, 'Put the query in a domain module and call that from the route').toEqual([]);
  });
});
