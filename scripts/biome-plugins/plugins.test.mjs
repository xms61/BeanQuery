import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs the repo's own Biome, with the linter settings and plugins from biome.json, over fixture files in a temp
// directory laid out like the repo, so each plugin's `includes` applies as it does to the real code.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const biome = join(repo, 'node_modules/@biomejs/biome/bin/biome');
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function lint(files) {
  const config = JSON.parse(readFileSync(join(repo, 'biome.json'), 'utf8'));
  const root = mkdtempSync(join(tmpdir(), 'biome-plugins-'));
  roots.push(root);
  const plugins = (config.plugins ?? []).map((plugin) => ({ ...plugin, path: resolve(repo, plugin.path) }));
  writeFileSync(join(root, 'biome.json'), JSON.stringify({ linter: config.linter, plugins }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const run = spawnSync(process.execPath, [biome, 'lint', '--reporter=json', '.'], { cwd: root, encoding: 'utf8' });
  const report = JSON.parse(run.stdout);
  return report.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.location.path.replace(/\\/g, '/')}:${d.location.start.line} ${d.category}: ${d.message}`);
}

function only(diagnostics, category) {
  return diagnostics.filter((line) => line.includes(` ${category}: `));
}

const RAW =
  'plugin: raw(), isEscaped and dangerouslySetInnerHTML skip JSX escaping (security-reviewer A05). Render the value as a JSX child or attribute, which Hono escapes.';

test('raw HTML is refused in src/', () => {
  const found = lint({
    'src/web/page.tsx': [
      "import { raw } from 'hono/html';",
      'export const A = (p: { body: string }) => <div>{raw(p.body)}</div>;',
      'export const B = (p: { body: string }) => <div dangerouslySetInnerHTML={{ __html: p.body }} />;',
      'export const C = (p: { body: string }) => <div class="note">{p.body}</div>;',
      'export const D = (h: { raw(s: string): string }, s: string) => h.raw(s);',
      'export const E = (s: string) => Object.assign(new String(s), { isEscaped: true });',
      'export const F = (s: { isEscaped?: boolean }) => {',
      '  s.isEscaped = true;',
      '};',
      '',
    ].join('\n'),
  });
  assert.deepEqual(
    only(found, 'plugin'),
    [2, 3, 5, 6, 8].map((line) => `src/web/page.tsx:${line} ${RAW}`),
  );
});

test('raw is never imported from Hono, even under another name', () => {
  const found = lint({
    'src/web/page.tsx': [
      "import { raw as unescaped } from 'hono/html';",
      "import { raw as same } from 'hono/utils/html';",
      'export const A = (s: string) => [unescaped(s), same(s)];',
      '',
    ].join('\n'),
  });
  assert.deepEqual(
    only(found, 'lint/style/noRestrictedImports').map((line) => line.split(':').slice(0, 2).join(':')),
    ['src/web/page.tsx:1 lint/style/noRestrictedImports', 'src/web/page.tsx:2 lint/style/noRestrictedImports'],
  );
});

test('inline style and event attributes are refused in JSX', () => {
  const found = lint({
    'src/web/page.tsx': [
      'export const A = () => <div style="color: red">a</div>;',
      'export const B = () => <button type="button" onclick="go()">b</button>;',
      'export const C = () => <a class="tab" href="/stats" aria-current="page" role="tab">c</a>;',
      'export const D = () => <form onSubmit="go()">d</form>;',
      '',
    ].join('\n'),
  });
  const message =
    'plugin: Inline style= and on*= attributes need the content policy loosened (security-reviewer A02). Put the style in src/web/assets/style.ts and the behavior in the app script.';
  assert.deepEqual(
    only(found, 'plugin'),
    [1, 2, 4].map((line) => `src/web/page.tsx:${line} ${message}`),
  );
});

test('Math.random is refused in src/, called or passed along', () => {
  const found = lint({
    'src/account/token.ts': [
      "import { randomBytes } from 'node:crypto';",
      'export const weak = Math.random();',
      "export const strong = randomBytes(16).toString('hex');",
      'export const many = [1, 2].map(Math.random);',
      '',
    ].join('\n'),
  });
  const message =
    'plugin: Math.random() is predictable (security-reviewer A04). Use randomBytes or randomInt from node:crypto.';
  assert.deepEqual(
    only(found, 'plugin'),
    [2, 4].map((line) => `src/account/token.ts:${line} ${message}`),
  );
});

test('Zod schemas in src/ never keep unknown keys', () => {
  const found = lint({
    'src/contract/shape.ts': [
      "import { looseObject, z } from 'zod';",
      'export const a = z.object({ name: z.string() }).passthrough();',
      'export const b = z.looseObject({ name: z.string() });',
      'export const c = z.object({ name: z.string() }).catchall(z.string());',
      'export const d = z.object({ name: z.string() });',
      'export const e = z.strictObject({ name: z.string() });',
      'export const f = z.object({ name: z.string() }).loose();',
      'export const g = looseObject({ name: z.string() });',
      '',
    ].join('\n'),
  });
  const message =
    'plugin: Input schemas strip or refuse unknown keys (security-reviewer A08). Use z.object or z.strictObject, not passthrough, loose, looseObject or catchall.';
  assert.deepEqual(
    only(found, 'plugin'),
    [2, 3, 4, 7, 8].map((line) => `src/contract/shape.ts:${line} ${message}`),
  );
});

test('parseBody takes no options', () => {
  const found = lint({
    'src/web/routes/form.tsx': [
      'type C = { req: { parseBody<T = Record<string, unknown>>(options?: object): Promise<T> } };',
      'export const a = (c: C) => c.req.parseBody({ dot: true });',
      "export const b = (c: C) => c.req.parseBody<Record<string, string>>({ 'all': true });",
      'export const d = (c: C) => c.req.parseBody();',
      'export const e = (c: C, options: object) => c.req.parseBody(options);',
      'export const f = (c: C) => c.req.parseBody<Record<string, string>>();',
      '',
    ].join('\n'),
  });
  const message =
    "plugin: parseBody's options (dot, all) build nested objects and arrays from form input (security-reviewer A08). Read flat fields; if a route needs them, validate the shape with Zod and add a biome-ignore with the reason.";
  assert.deepEqual(
    only(found, 'plugin'),
    [2, 3, 5].map((line) => `src/web/routes/form.tsx:${line} ${message}`),
  );
});

test('skipped and focused tests fail the lint', () => {
  const found = lint({
    'src/bag/bag.test.ts': [
      "import { describe, test } from 'vitest';",
      "test.skip('a', () => {});",
      "describe.only('b', () => {});",
      "test('c', () => {});",
      '',
    ].join('\n'),
  });
  assert.deepEqual(
    found.map((line) => line.split(':').slice(0, 2).join(':')),
    ['src/bag/bag.test.ts:2 lint/suspicious/noSkippedTests', 'src/bag/bag.test.ts:3 lint/suspicious/noFocusedTests'],
  );
});

test('the plugins leave code outside their folders alone', () => {
  const found = lint({ 'scripts/tool.mjs': 'export const seed = Math.random();\n' });
  assert.deepEqual(only(found, 'plugin'), []);
});
