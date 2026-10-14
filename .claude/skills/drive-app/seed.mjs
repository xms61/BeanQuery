#!/usr/bin/env node
// Seeds a fresh database for a drive-app run: the fixture's roasters, one admin account holding the fixture's first
// four bags, and the fifth bag as a document to paste. Run `pnpm build` first; this imports the built app from dist/.
// The account number is written to a file in the run folder, never printed, so it stays out of logs and chat.
//   node .claude/skills/drive-app/seed.mjs --db <run>/beanquery.db --out <run>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const dist = (path) => pathToFileURL(join(repo, 'dist', path)).href;
const { values } = parseArgs({ options: { db: { type: 'string' }, out: { type: 'string' } } });
if (!values.db || !values.out) {
  console.error('Usage: node .claude/skills/drive-app/seed.mjs --db <run>/beanquery.db --out <run>');
  process.exit(1);
}
if (existsSync(values.db)) {
  console.error(`${values.db} already exists. Seed a new run folder; never an existing database.`);
  process.exit(1);
}
if (!existsSync(join(repo, 'dist/web/server.js'))) {
  console.error('dist/ is missing. Run `pnpm build` first.');
  process.exit(1);
}

const { openDatabase } = await import(dist('db.js'));
const { migrate } = await import(dist('db/migrate.js'));
const { importRoasters } = await import(dist('roaster/import.js'));
const { createAdmin } = await import(dist('account/bootstrap.js'));
const { importBags } = await import(dist('bag/import.js'));
const { pasteLimits } = await import(dist('contract/bag-json.js'));

const fixture = JSON.parse(readFileSync(join(repo, 'src/contract/fixtures/owner-bags-2026-10-12.json'), 'utf8'));
mkdirSync(values.out, { recursive: true });
mkdirSync(dirname(values.db), { recursive: true });
const db = openDatabase(values.db);
migrate(db);
importRoasters(db, [
  { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
  { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
]);
const { accountId, accountNumber } = createAdmin(db, new Date());
const seeded = importBags(db, accountId, JSON.stringify({ ...fixture, bags: fixture.bags.slice(0, 4) }), {
  limits: pasteLimits,
});
db.close();
if (seeded.status !== 'saved') {
  console.error(`Seeding the bags failed: ${JSON.stringify(seeded)}`);
  process.exit(1);
}

writeFileSync(join(values.out, 'account-number.txt'), `${accountNumber}\n`);
writeFileSync(
  join(values.out, 'paste-one-bag.json'),
  `${JSON.stringify({ ...fixture, bags: [fixture.bags[4]] }, null, 2)}\n`,
);
console.log(
  `Seeded ${seeded.bagIds.length} bags. Account number in account-number.txt; the bag to paste in paste-one-bag.json.`,
);
