import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { createInvite } from '../account/account.js';
import { exportBags } from '../bag/export.js';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { editCoffee } from '../coffee/edit.js';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { findRoasters } from '../roaster/registry.js';
import {
  addRoasterAlias,
  adminAddRoaster,
  adminCoffee,
  adminCreateInvite,
  adminDeleteAccount,
  adminEditCoffee,
  adminImportRoasters,
  adminOpenInviteCount,
  adminPoolCoffees,
  deletePoolCoffee,
  editLog,
  listAccounts,
  mergeCoffees,
  undoEdit,
} from './admin.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);
const now = new Date('2026-10-12T12:00:00Z');

/** Account 1 is the admin, with the five real bags (pool coffees 1 to 5). Accounts 2 and 3 are friends with none. */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, is_admin, created_on, last_seen_on) VALUES
    (1, randomblob(32), 1, '2026-10-01', '2026-10-12'),
    (2, randomblob(32), 0, '2026-10-02', '2026-10-10'),
    (3, randomblob(32), 0, '2026-10-03', '2026-10-11')`);
  importBags(db, 1, JSON.stringify(fixture), { limits: pasteLimits });
  return db;
}

/** A bag of Sasaba (or a renamed copy) with a harvest, for account `accountId`. */
function sasabaBag(db: DatabaseSync, accountId: number, harvest: string, name = 'Ethiopia Sasaba') {
  const bag = structuredClone(fixture.bags[0]);
  bag.coffee.name = name;
  bag.harvest = harvest;
  const result = addBag(db, accountId, bag, { coffeeChoice: 'new' });
  if (result.status !== 'saved') throw new Error(`could not add ${name}: ${JSON.stringify(result)}`);
}

const coffeeOf = (db: DatabaseSync, name: string) =>
  Number(db.prepare('SELECT id FROM coffee WHERE name = ? AND owner_account_id IS NULL').get(name)?.id);
const count = (db: DatabaseSync, sql: string, ...args: number[]) => Number(db.prepare(sql).get(...args)?.n);

describe('admin tools', () => {
  test('refuse every action to an account that is not an admin, and change nothing', () => {
    const db = seeded();
    sasabaBag(db, 2, '2025');
    db.prepare(
      'INSERT INTO coffee_edit (coffee_id, account_id, field, old_value, new_value, edited_on) VALUES (1, 2, ?, ?, ?, ?)',
    ).run('region', 'Guji', 'Somewhere', '2026-10-12');
    const before = JSON.stringify(exportBags(db, 2));
    const notAdmin = { status: 'not_admin' };

    expect(adminCreateInvite(db, 2, now)).toEqual(notAdmin);
    expect(adminOpenInviteCount(db, 2, now)).toEqual(notAdmin);
    expect(listAccounts(db, 2)).toEqual(notAdmin);
    expect(adminDeleteAccount(db, 2, 3)).toEqual(notAdmin);
    expect(adminAddRoaster(db, 2, 'Bonanza')).toEqual(notAdmin);
    expect(addRoasterAlias(db, 2, 1, 'Nord')).toEqual(notAdmin);
    expect(adminEditCoffee(db, 2, 1, { ...fixture.bags[0].coffee, region: 'X' })).toEqual(notAdmin);
    expect(editLog(db, 2, 1)).toEqual(notAdmin);
    expect(undoEdit(db, 2, 1)).toEqual(notAdmin);
    expect(mergeCoffees(db, 2, 1, 2)).toEqual(notAdmin);
    expect(deletePoolCoffee(db, 2, 1)).toEqual(notAdmin);
    // A missing account is not an admin either.
    expect(listAccounts(db, 99)).toEqual(notAdmin);

    expect(JSON.stringify(exportBags(db, 2))).toBe(before);
    expect(count(db, 'SELECT count(*) AS n FROM account')).toBe(3);
    expect(count(db, 'SELECT count(*) AS n FROM invite')).toBe(0);
    expect(count(db, 'SELECT count(*) AS n FROM roaster')).toBe(2);
    expect(count(db, 'SELECT count(*) AS n FROM roaster_alias')).toBe(0);
    expect(count(db, 'SELECT count(*) AS n FROM coffee WHERE owner_account_id IS NULL')).toBe(5);
    db.close();
  });

  test('create invites and count the open ones', () => {
    const db = seeded();
    expect(adminCreateInvite(db, 1, now)).toMatchObject({ status: 'saved', expiresOn: '2026-10-26' });
    createInvite(db, now);
    expect(adminOpenInviteCount(db, 1, now)).toBe(2);
    db.close();
  });

  test('list accounts by a short fingerprint and last-seen date, most recent first', () => {
    const db = seeded();
    const accounts = listAccounts(db, 1);
    expect(accounts).toMatchObject([
      { accountId: 1, admin: true, createdOn: '2026-10-01', lastSeenOn: '2026-10-12' },
      { accountId: 3, admin: false, lastSeenOn: '2026-10-11' },
      { accountId: 2, admin: false, lastSeenOn: '2026-10-10' },
    ]);
    const hex = db.prepare('SELECT hex(key_hash) AS h FROM account WHERE id = 3').get()?.h as string;
    expect((accounts as { fingerprint: string }[])[1]?.fingerprint).toBe(hex.slice(0, 8));
    db.close();
  });

  test('delete another account with all its rows, but not their own', () => {
    const db = seeded();
    sasabaBag(db, 2, '2025');
    expect(adminDeleteAccount(db, 1, 2)).toEqual({ status: 'deleted' });
    expect(count(db, 'SELECT count(*) AS n FROM bag WHERE account_id = 2')).toBe(0);
    expect(adminDeleteAccount(db, 1, 2)).toEqual({ status: 'not_found' });
    expect(adminDeleteAccount(db, 1, 1)).toEqual({ status: 'own_account' });
    expect(count(db, 'SELECT count(*) AS n FROM account WHERE id = 1')).toBe(1);
    db.close();
  });

  test('add a roaster and an alias, both found on the next paste', () => {
    const db = seeded();
    const added = adminAddRoaster(db, 1, 'Bonanza Coffee');
    expect(added).toMatchObject({ status: 'saved', roaster: { name: 'Bonanza Coffee', source: 'admin' } });
    const nord = findRoasters(db, 'Nord Kaffe')[0]?.id as number;

    expect(addRoasterAlias(db, 1, nord, 'Nordkaffe Oslo')).toEqual({ status: 'saved' });
    expect(addRoasterAlias(db, 1, nord, 'NORDKAFFE  oslo')).toEqual({ status: 'saved' });
    expect(findRoasters(db, 'Nordkaffe Oslo').map((r) => r.id)).toEqual([nord]);
    expect(count(db, 'SELECT count(*) AS n FROM roaster_alias')).toBe(1);
    expect(addRoasterAlias(db, 1, nord, ' -- ')).toEqual({ status: 'invalid' });
    expect(addRoasterAlias(db, 1, 999, 'Somebody')).toEqual({ status: 'not_found' });

    const bag = structuredClone(fixture.bags[0]);
    bag.roaster.name = 'Nordkaffe Oslo';
    expect(addBag(db, 2, bag)).toMatchObject({ status: 'saved' });
    db.close();
  });

  test('edit a pool coffee without a bag on it, logged under the admin; private coffees are out of reach', () => {
    const db = seeded();
    const peru = coffeeOf(db, 'Peru La Danta');
    db.prepare('UPDATE bag SET account_id = 2, grinder_id = NULL WHERE coffee_id = ?').run(peru);
    const facts = { ...fixture.bags[1].coffee, region: 'Cajamarca' };
    expect(adminEditCoffee(db, 1, peru, facts)).toMatchObject({ status: 'saved', changed: ['region'] });
    expect(editLog(db, 1, peru)).toMatchObject([{ field: 'region', newValue: 'Cajamarca' }]);

    const privateBag = structuredClone(fixture.bags[0]);
    privateBag.coffee.name = 'Secret Lot';
    privateBag.personal = { ...privateBag.personal, private: true };
    addBag(db, 2, privateBag);
    const secret = Number(db.prepare("SELECT id FROM coffee WHERE name = 'Secret Lot'").get()?.id);
    expect(adminEditCoffee(db, 1, secret, { ...privateBag.coffee, region: 'Leak' })).toEqual({ status: 'not_found' });
    expect(editLog(db, 1, secret)).toEqual([]);
    expect(adminEditCoffee(db, 1, peru, { name: '' })).toMatchObject({ status: 'invalid' });
    db.close();
  });

  test('the edit log shows who edited, newest first, and keeps edits of deleted accounts without an editor', () => {
    const db = seeded();
    sasabaBag(db, 2, '2025');
    editCoffee(db, 2, 1, { ...fixture.bags[0].coffee, region: 'Guji, Uraga' });
    editCoffee(db, 1, 1, { ...fixture.bags[0].coffee, region: 'Guji, Hambela' });
    const fingerprint = (id: number) =>
      String(db.prepare('SELECT hex(key_hash) AS h FROM account WHERE id = ?').get(id)?.h).slice(0, 8);
    const admin = fingerprint(1);

    expect(editLog(db, 1, 1)).toMatchObject([
      {
        field: 'region',
        oldValue: 'Guji, Uraga',
        newValue: 'Guji, Hambela',
        editor: admin,
        editedOn: expect.any(String),
      },
      { field: 'region', oldValue: 'Guji', newValue: 'Guji, Uraga', editor: fingerprint(2) },
    ]);
    adminDeleteAccount(db, 1, 2);
    expect((editLog(db, 1, 1) as { editor: string | null }[]).map((e) => e.editor)).toEqual([admin, null]);
    db.close();
  });

  test('undo restores the old value and logs the undo, which can be undone in turn', () => {
    const db = seeded();
    editCoffee(db, 1, 1, { ...fixture.bags[0].coffee, region: 'Guji, Uraga', tasting_notes: ['Peach'] });
    const [notes, region] = editLog(db, 1, 1) as { editId: number; field: string }[];
    expect([region?.field, notes?.field]).toEqual(['region', 'tasting_notes']);

    expect(undoEdit(db, 1, region?.editId as number)).toEqual({ status: 'saved', changed: ['region'] });
    expect(undoEdit(db, 1, notes?.editId as number)).toEqual({ status: 'saved', changed: ['tasting_notes'] });
    expect(exportBags(db, 1).bags[0]?.coffee).toEqual(fixture.bags[0].coffee);
    const log = editLog(db, 1, 1) as { editId: number; field: string; oldValue: string; newValue: string }[];
    expect(log.slice(0, 2)).toMatchObject([
      { field: 'tasting_notes', newValue: JSON.stringify(fixture.bags[0].coffee.tasting_notes) },
      { field: 'region', oldValue: 'Guji, Uraga', newValue: 'Guji' },
    ]);

    expect(undoEdit(db, 1, log[1]?.editId as number)).toMatchObject({ status: 'saved' });
    expect(exportBags(db, 1).bags[0]?.coffee.region).toBe('Guji, Uraga');
    expect(undoEdit(db, 1, 999)).toEqual({ status: 'not_found' });
    db.close();
  });

  test('undo empties a list that a paste filled from nothing', () => {
    const db = seeded();
    db.exec('DELETE FROM coffee_variety WHERE coffee_id = 1');
    sasabaBag(db, 2, '2025');
    const [fill] = editLog(db, 1, 1) as { editId: number; field: string; oldValue: string | null }[];
    expect(fill).toMatchObject({ field: 'varieties', oldValue: null });

    expect(undoEdit(db, 1, fill?.editId as number)).toEqual({ status: 'saved', changed: ['varieties'] });
    expect(count(db, 'SELECT count(*) AS n FROM coffee_variety WHERE coffee_id = 1')).toBe(0);
    db.close();
  });

  test('undoing a rename is refused when another pool coffee of the roaster has taken the old name since', () => {
    const db = seeded();
    editCoffee(db, 1, 1, { ...fixture.bags[0].coffee, name: 'Ethiopia Sasaba Lot 7' });
    const [rename] = editLog(db, 1, 1) as { editId: number }[];
    sasabaBag(db, 2, '2025', 'Ethiopia Sasaba');
    const taker = coffeeOf(db, 'Ethiopia Sasaba');

    expect(undoEdit(db, 1, rename?.editId as number)).toEqual({ status: 'name_taken', coffeeId: taker });
    expect(db.prepare('SELECT name FROM coffee WHERE id = 1').get()).toEqual({ name: 'Ethiopia Sasaba Lot 7' });
    expect((editLog(db, 1, 1) as unknown[]).length).toBe(1);
    db.close();
  });

  test('merging keeps every bag and the union of the harvests, and deletes the other coffee', () => {
    const db = seeded();
    sasabaBag(db, 2, '2024');
    sasabaBag(db, 2, '2025', 'Ethiopia Sasaba Washed');
    sasabaBag(db, 3, '2026', 'Ethiopia Sasaba Washed');
    const keep = coffeeOf(db, 'Ethiopia Sasaba');
    const drop = coffeeOf(db, 'Ethiopia Sasaba Washed');
    const bags = count(db, 'SELECT count(*) AS n FROM bag');

    expect(mergeCoffees(db, 1, keep, coffeeOf(db, 'Ethiopia - Elto [Hamasho 72h]'))).toEqual({
      status: 'different_roasters',
    });
    expect(mergeCoffees(db, 1, keep, drop)).toEqual({ status: 'merged', movedBags: 2 });
    expect(count(db, 'SELECT count(*) AS n FROM bag')).toBe(bags);
    expect(count(db, 'SELECT count(*) AS n FROM coffee WHERE id = ?', drop)).toBe(0);
    expect(db.prepare('SELECT harvest FROM coffee_harvest WHERE coffee_id = ? ORDER BY harvest').all(keep)).toEqual([
      { harvest: '2024' },
      { harvest: '2025' },
      { harvest: '2026' },
    ]);
    expect(mergeCoffees(db, 1, keep, keep)).toEqual({ status: 'not_found' });
    db.close();
  });

  test('deleting a used pool coffee moves each account’s bags to a private copy, or to its own private coffee', () => {
    const db = seeded();
    sasabaBag(db, 2, '2025');
    sasabaBag(db, 2, '2026');
    const own = structuredClone(fixture.bags[0]);
    own.personal = { ...own.personal, private: true };
    addBag(db, 3, own);
    sasabaBag(db, 3, '2026');
    const sasaba = coffeeOf(db, 'Ethiopia Sasaba');
    const bags = count(db, 'SELECT count(*) AS n FROM bag');
    const threesPrivate = Number(db.prepare('SELECT id FROM coffee WHERE owner_account_id = 3').get()?.id);

    expect(deletePoolCoffee(db, 1, sasaba)).toEqual({ status: 'deleted', movedBags: 4 });
    expect(count(db, 'SELECT count(*) AS n FROM bag')).toBe(bags);
    expect(count(db, 'SELECT count(*) AS n FROM coffee WHERE id = ?', sasaba)).toBe(0);
    // Account 3 already had a private Sasaba, so its pool bag joins it instead of a second copy.
    expect(count(db, 'SELECT count(*) AS n FROM bag WHERE account_id = 3 AND coffee_id = ?', threesPrivate)).toBe(2);
    for (const account of [1, 2, 3]) {
      const coffees = db
        .prepare(
          'SELECT DISTINCT c.owner_account_id AS owner FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.account_id = ? AND c.name = ?',
        )
        .all(account, 'Ethiopia Sasaba');
      expect(coffees).toEqual([{ owner: account }]);
    }
    expect(exportBags(db, 2).bags[0]?.coffee).toEqual(fixture.bags[0].coffee);
    expect(deletePoolCoffee(db, 1, threesPrivate)).toEqual({ status: 'not_found' });
    db.close();
  });
});

describe('admin screens data', () => {
  test('imports a saved roaster page, and refuses one without roaster links', () => {
    const db = seeded();
    const page =
      '<a href="/roaster/friedhats">Friedhats</a> <a href="https://every.coffee/roaster/nord-kaffe">Nord Kaffe</a>';
    expect(adminImportRoasters(db, 1, page)).toEqual({
      status: 'saved',
      summary: { added: 1, renamed: 0, unchanged: 1, notListed: 1 },
    });
    expect(adminImportRoasters(db, 1, '<p>Just a moment...</p>')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('Found no roaster links'),
    });
    expect(adminImportRoasters(db, 2, page)).toEqual({ status: 'not_admin' });
    db.close();
  });

  test('refuses a roaster name without a letter or digit', () => {
    const db = seeded();
    expect(adminAddRoaster(db, 1, ' -- ')).toEqual({ status: 'invalid' });
    expect(count(db, 'SELECT count(*) AS n FROM roaster')).toBe(2);
    db.close();
  });

  test("lists pool coffees with every account's bags and the edit log's size, never a private coffee", () => {
    const db = seeded();
    sasabaBag(db, 2, '2025');
    const secret = structuredClone(fixture.bags[1]);
    secret.coffee.name = 'Secret Danta';
    secret.personal = { private: true };
    addBag(db, 3, secret);
    adminEditCoffee(db, 1, 1, { ...fixture.bags[0].coffee, region: 'Uraga' });

    const all = adminPoolCoffees(db, 1);
    if (!('coffees' in all)) throw new Error('not admin');
    expect(all.total).toBe(5);
    expect(all.coffees.map((c) => c.name)).not.toContain('Secret Danta');
    expect(all.coffees.find((c) => c.name === 'Ethiopia Sasaba')).toMatchObject({ bags: 2, edits: 1 });
    expect(adminPoolCoffees(db, 1, 'nord danta')).toMatchObject({ total: 1, coffees: [{ name: 'Peru La Danta' }] });
    expect(adminPoolCoffees(db, 2)).toEqual({ status: 'not_admin' });
    db.close();
  });

  test("shows one pool coffee with the roaster's other pool coffees to merge into", () => {
    const db = seeded();
    const sasaba = coffeeOf(db, 'Ethiopia Sasaba');
    expect(adminCoffee(db, 1, sasaba)).toMatchObject({
      status: 'found',
      roaster: 'Nord Kaffe',
      facts: { name: 'Ethiopia Sasaba' },
      bags: 1,
      others: [{ name: 'Peru La Danta' }],
    });
    const secret = structuredClone(fixture.bags[1]);
    secret.coffee.name = 'Secret Danta';
    secret.personal = { private: true };
    addBag(db, 3, secret);
    const secretId = Number(db.prepare("SELECT id FROM coffee WHERE name = 'Secret Danta'").get()?.id);
    expect(adminCoffee(db, 1, secretId)).toEqual({ status: 'not_found' });
    expect(adminCoffee(db, 2, sasaba)).toEqual({ status: 'not_admin' });
    db.close();
  });
});
