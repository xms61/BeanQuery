import { describe, expect, test } from 'vitest';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { pasteLimits } from '../contract/bag-json.js';
import { fixture, redeemed, setup } from './test-support.js';

/** One account with the fixture's five bags on pool coffees 1 to 5, and a private bean; a second account without. */
async function twoAccounts() {
  const env = setup();
  const me = await redeemed(env.request, env.db);
  const other = await redeemed(env.request, env.db);
  importBags(env.db, me.accountId, JSON.stringify(fixture), { limits: pasteLimits });
  const secret = structuredClone(fixture.bags[0]);
  secret.coffee.name = 'Secret Sasaba';
  secret.personal = { private: true };
  addBag(env.db, me.accountId, secret);
  const secretId = Number(env.db.prepare("SELECT id FROM coffee WHERE name = 'Secret Sasaba'").get()?.id);
  return { ...env, me, other, secretId };
}

describe('signed out', () => {
  test('the pool, roasters and gear send visitors to sign in', async () => {
    const { request } = setup();
    for (const path of ['/pool', '/pool/1', '/roasters', '/roasters/1', '/gear']) {
      expect([path, (await request(path)).status]).toEqual([path, 303]);
    }
  });
});

describe('the pool', () => {
  test("lists and filters pool coffees for any account, never another account's private bean", async () => {
    const { request, other } = await twoAccounts();
    const html = await (await request('/pool', { cookie: other.cookie })).text();
    expect(html).toContain('Ethiopia Sasaba');
    expect(html).not.toContain('Secret Sasaba');
    expect(html).toContain('href="/add/manual?from=1"');

    const filtered = await (await request('/pool?roaster=Nord+Kaffe&process=natural', { cookie: other.cookie })).text();
    expect(filtered).toContain('Ethiopia Sasaba');
    expect(filtered).not.toContain('Panama - Elida');
  });

  test("shows a pool coffee's page with only the viewer's own bags", async () => {
    const { request, me, other } = await twoAccounts();
    const mine = await (await request('/pool/1', { cookie: me.cookie })).text();
    expect(mine).toContain('Ethiopia Sasaba');
    expect(mine).toContain('href="/bags/1"');
    expect(mine).toContain('href="/bags/1/edit"');

    const theirs = await (await request('/pool/1', { cookie: other.cookie })).text();
    expect(theirs).toContain('start a bag to edit them');
    expect(theirs).not.toContain('/bags/1');
  });

  test("answers another account's private coffee as not found, and shows the owner theirs", async () => {
    const { request, me, other, secretId } = await twoAccounts();
    expect((await request(`/pool/${secretId}`, { cookie: other.cookie })).status).toBe(404);
    const own = await request(`/pool/${secretId}`, { cookie: me.cookie });
    expect(own.status).toBe(200);
    expect(await own.text()).toContain('Your private coffee');
  });
});

describe('the roasters', () => {
  test("list each roaster with the account's bags and keep each account's note private", async () => {
    const { db, request, me, other } = await twoAccounts();
    const nord = Number(db.prepare("SELECT id FROM roaster WHERE slug = 'nord-kaffe'").get()?.id);
    const list = await (await request('/roasters?only=bags', { cookie: me.cookie })).text();
    expect(list).toContain('Nord Kaffe');
    expect(list).toContain('every.coffee/roaster/nord-kaffe');

    const saved = await request(`/roasters/${nord}/note`, { form: { note: 'Order on <Mondays>' }, cookie: me.cookie });
    expect(saved.status).toBe(303);
    expect(await (await request(`/roasters/${nord}`, { cookie: me.cookie })).text()).toContain(
      'Order on &lt;Mondays&gt;</textarea>',
    );
    expect(await (await request(`/roasters/${nord}`, { cookie: other.cookie })).text()).not.toContain('Mondays');
    expect(await (await request('/roasters?only=notes', { cookie: other.cookie })).text()).toContain(
      'No roaster matches.',
    );

    expect(
      (await request(`/roasters/${nord}/note`, { form: { note: 'x'.repeat(501) }, cookie: me.cookie })).status,
    ).toBe(400);
    expect((await request('/roasters/99999', { cookie: me.cookie })).status).toBe(404);
  });
});

describe('the gear', () => {
  test("lists the account's grinders, renames one, and refuses to delete a used one", async () => {
    const { db, request, me, other } = await twoAccounts();
    const ode = Number(db.prepare('SELECT id FROM grinder WHERE account_id = ?').get(me.accountId)?.id);
    expect(await (await request('/gear', { cookie: me.cookie })).text()).toContain('value="Fellow Ode Gen 2"');
    expect(await (await request('/gear', { cookie: other.cookie })).text()).toContain('No grinders yet.');

    const renamed = await request(`/gear/${ode}`, { form: { name: 'Ode Gen 2', note: 'SSP' }, cookie: me.cookie });
    expect(renamed.status).toBe(303);
    expect(db.prepare('SELECT name, note FROM grinder WHERE id = ?').get(ode)).toEqual({
      name: 'Ode Gen 2',
      note: 'SSP',
    });

    const refused = await request(`/gear/${ode}/delete`, { form: {}, cookie: me.cookie });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('6 bags use this grinder, so it stays.');
    expect((await request(`/gear/${ode}`, { form: { name: 'Mine', note: '' }, cookie: other.cookie })).status).toBe(
      404,
    );
  });
});
