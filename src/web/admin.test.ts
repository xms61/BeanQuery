import { describe, expect, test } from 'vitest';
import { createAdmin } from '../account/bootstrap.js';
import { importBags } from '../bag/import.js';
import { pasteLimits } from '../contract/bag-json.js';
import { coffeeToForm } from './bag-form.js';
import { fixture, redeemed, sessionCookie, setup } from './test-support.js';

type Db = ReturnType<typeof setup>['db'];
const count = (db: Db, sql: string) => Number(db.prepare(sql).get()?.n);

/** An admin with the fixture's five bags on pool coffees 1 to 5, and a friend with a bag on coffee 1. */
async function withAdmin() {
  const env = setup();
  const admin = createAdmin(env.db, new Date('2026-10-12T12:00:00Z'));
  const adminCookie = sessionCookie(
    await env.request('/sign-in', { form: { account_number: admin.accountNumber } }),
  ) as string;
  const adminId = Number(env.db.prepare('SELECT id FROM account WHERE is_admin = 1').get()?.id);
  importBags(env.db, adminId, JSON.stringify(fixture), { limits: pasteLimits });
  const friend = await redeemed(env.request, env.db);
  const one = { ...structuredClone(fixture), bags: [fixture.bags[0]] };
  importBags(env.db, friend.accountId, JSON.stringify(one), { limits: pasteLimits });
  return { ...env, adminCookie, adminId, friend };
}

describe('the admin screens', () => {
  test('answer not found to anyone but an admin, and change nothing', async () => {
    const { db, request, friend } = await withAdmin();
    for (const path of ['/admin', '/admin/roasters', '/admin/coffees', '/admin/coffees/1']) {
      expect([path, (await request(path, { cookie: friend.cookie })).status]).toEqual([path, 404]);
    }
    const posts: [string, Record<string, string>][] = [
      ['/admin/invites', {}],
      ['/admin/accounts/1/delete', { confirm: 'yes' }],
      ['/admin/roasters', { name: 'Bonanza' }],
      ['/admin/coffees/1', coffeeToForm({ ...fixture.bags[0].coffee, region: 'X' })],
      ['/admin/coffees/1/delete', { confirm: 'yes' }],
    ];
    for (const [path, form] of posts) {
      expect([path, (await request(path, { form, cookie: friend.cookie })).status]).toEqual([path, 404]);
    }
    const upload = new FormData();
    upload.set('file', new File(['<a href="/roaster/x">X</a>'], 'roasters.html'));
    expect((await request('/admin/roasters/upload', { multipart: upload, cookie: friend.cookie })).status).toBe(404);

    expect(count(db, 'SELECT count(*) AS n FROM invite')).toBe(0);
    expect(count(db, 'SELECT count(*) AS n FROM account')).toBe(2);
    expect(count(db, 'SELECT count(*) AS n FROM roaster')).toBe(2);
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Guji' });
    expect((await request('/admin')).status).toBe(303);
  });

  test('create an invite shown once, and delete another account only when confirmed', async () => {
    const { db, request, adminCookie, adminId, friend } = await withAdmin();
    const invited = await (await request('/admin/invites', { form: {}, cookie: adminCookie })).text();
    expect(invited).toMatch(/class="secret">[0-9A-Z]{4}( [0-9A-Z]{4})+</);
    expect(invited).toContain('1</strong>');

    const page = await (await request('/admin', { cookie: adminCookie })).text();
    expect(page).toContain(`/admin/accounts/${friend.accountId}/delete`);
    expect(page).not.toContain(`/admin/accounts/${adminId}/delete`);

    expect(
      (await request(`/admin/accounts/${friend.accountId}/delete`, { form: {}, cookie: adminCookie })).status,
    ).toBe(400);
    const own = await request(`/admin/accounts/${adminId}/delete`, { form: { confirm: 'yes' }, cookie: adminCookie });
    expect(own.status).toBe(400);
    const deleted = await request(`/admin/accounts/${friend.accountId}/delete`, {
      form: { confirm: 'yes' },
      cookie: adminCookie,
    });
    expect(deleted.status).toBe(303);
    expect(count(db, 'SELECT count(*) AS n FROM account')).toBe(1);
  });

  test('add a roaster and a spelling, asking which roaster when a name is shared', async () => {
    const { db, request, adminCookie } = await withAdmin();
    expect(await (await request('/admin/roasters', { form: { name: 'Nord' }, cookie: adminCookie })).text()).toContain(
      'Nord is registered.',
    );
    expect((await request('/admin/roasters', { form: { name: ' -- ' }, cookie: adminCookie })).status).toBe(400);

    const one = await request('/admin/roasters/spelling', {
      form: { roaster: 'Tanat', spelling: 'Tanat Paris' },
      cookie: adminCookie,
    });
    expect(await one.text()).toContain('“Tanat Paris” now resolves without asking.');
    expect(db.prepare("SELECT alias_key FROM roaster_alias WHERE alias_key = 'tanat paris'").all()).toHaveLength(1);

    // "Nord Kaffe" and the admin's "Nord" differ, but an alias can make two roasters share a name.
    const nord = Number(db.prepare("SELECT id FROM roaster WHERE slug = 'nord-kaffe'").get()?.id);
    db.prepare("INSERT INTO roaster_alias (alias_key, roaster_id) VALUES ('nord', ?)").run(nord);
    const asked = await (
      await request('/admin/roasters/spelling', { form: { roaster: 'Nord', spelling: 'Nordic' }, cookie: adminCookie })
    ).text();
    expect(asked).toContain('Several roasters have that name');
    expect(asked).toContain(`name="roaster_id" value="${nord}"`);
    const none = await request('/admin/roasters/spelling', {
      form: { roaster: 'Nobody', spelling: 'Nobody Else' },
      cookie: adminCookie,
    });
    expect([none.status, (await none.text()).includes('No registered roaster has that name.')]).toEqual([400, true]);
  });

  test('import a saved every.coffee page, and refuse one without roaster links', async () => {
    const { db, request, adminCookie } = await withAdmin();
    const upload = new FormData();
    upload.set('file', new File(['<a href="/roaster/friedhats">Friedhats</a>'], 'roasters.html'));
    const imported = await request('/admin/roasters/upload', { multipart: upload, cookie: adminCookie });
    expect(await imported.text()).toContain('Imported: 1 new, 0 renamed, 0 unchanged, 2 no longer listed (kept).');
    expect(count(db, "SELECT count(*) AS n FROM roaster WHERE slug = 'friedhats'")).toBe(1);

    const challenge = new FormData();
    challenge.set('file', new File(['<p>Just a moment...</p>'], 'roasters.html'));
    const refused = await request('/admin/roasters/upload', { multipart: challenge, cookie: adminCookie });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Found no roaster links');
  });
});

describe('pool coffees in the admin', () => {
  test('edit facts with a log entry, then undo it', async () => {
    const { db, request, adminCookie } = await withAdmin();
    const list = await (await request('/admin/coffees?q=sasaba', { cookie: adminCookie })).text();
    expect(list).toContain('href="/admin/coffees/1"');
    expect(list).not.toContain('Peru La Danta');

    const form = coffeeToForm({ ...fixture.bags[0].coffee, region: 'Uraga' });
    expect((await request('/admin/coffees/1', { form, cookie: adminCookie })).status).toBe(303);
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Uraga' });
    const page = await (await request('/admin/coffees/1', { cookie: adminCookie })).text();
    expect(page).toContain('Uraga');
    const editId = Number(db.prepare('SELECT max(id) AS id FROM coffee_edit').get()?.id);
    expect(page).toContain(`/admin/edits/${editId}/undo`);

    const undone = await request(`/admin/edits/${editId}/undo`, { form: { coffee: '1' }, cookie: adminCookie });
    expect([undone.status, undone.headers.get('location')]).toEqual([303, '/admin/coffees/1']);
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Guji' });
  });

  test('refuse a rename onto another pool coffee, and name the field of a bad fact', async () => {
    const { db, request, adminCookie } = await withAdmin();
    const taken = coffeeToForm({ ...fixture.bags[0].coffee, name: 'Peru La Danta' });
    const refused = await request('/admin/coffees/1', { form: taken, cookie: adminCookie });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('Merge the two instead.');
    const bad = { ...coffeeToForm(fixture.bags[0].coffee), 'coffee.altitude.min_m': '2000' };
    const invalid = await request('/admin/coffees/1', { form: bad, cookie: adminCookie });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain('<strong>Altitude');
    expect(db.prepare('SELECT name, altitude_min_m FROM coffee WHERE id = 1').get()).toEqual({
      name: 'Ethiopia Sasaba',
      altitude_min_m: null,
    });
  });

  test('merge keeps every bag, and delete moves each account’s bags to a private copy', async () => {
    const { db, request, adminCookie, adminId, friend } = await withAdmin();
    const merged = await request('/admin/coffees/1/merge', { form: { into: '2' }, cookie: adminCookie });
    expect([merged.status, merged.headers.get('location')]).toEqual([303, '/admin/coffees/2']);
    expect(count(db, 'SELECT count(*) AS n FROM bag WHERE coffee_id = 2')).toBe(3);
    expect(count(db, 'SELECT count(*) AS n FROM coffee WHERE id = 1')).toBe(0);

    expect((await request('/admin/coffees/2/delete', { form: {}, cookie: adminCookie })).status).toBe(400);
    const deleted = await request('/admin/coffees/2/delete', { form: { confirm: 'yes' }, cookie: adminCookie });
    expect(deleted.status).toBe(303);
    expect(count(db, 'SELECT count(*) AS n FROM bag')).toBe(6);
    const owners = db
      .prepare(
        `SELECT b.account_id, c.owner_account_id FROM bag b JOIN coffee c ON c.id = b.coffee_id
         WHERE c.name = 'Peru La Danta' OR c.name = 'Ethiopia Sasaba' ORDER BY b.id`,
      )
      .all();
    expect(owners.every((row) => row.account_id === row.owner_account_id)).toBe(true);
    expect(owners.map((row) => row.account_id)).toEqual([adminId, adminId, friend.accountId]);
  });
});
