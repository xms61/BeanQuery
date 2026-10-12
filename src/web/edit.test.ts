import { describe, expect, test } from 'vitest';
import { exportBags } from '../bag/export.js';
import { importBags } from '../bag/import.js';
import { addBag } from '../bag/manage.js';
import { parseBag, pasteLimits } from '../contract/bag-json.js';
import { bagToForm, formToBag } from './bag-form.js';
import { fixture, redeemed, setup } from './test-support.js';

type Db = ReturnType<typeof setup>['db'];
const count = (db: Db, table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

/** An account with the fixture's five bags, on pool coffees 1 to 5 (Ethiopia Sasaba is 1, Peru La Danta 2). */
async function withBags() {
  const env = setup();
  const me = await redeemed(env.request, env.db);
  importBags(env.db, me.accountId, JSON.stringify(fixture), { limits: pasteLimits });
  return { ...env, me };
}

/** The edit form as the browser would post it for an own bag, with some fields changed. */
function editForm(db: Db, accountId: number, bagIndex: number, change: Record<string, string> = {}) {
  const bag = exportBags(db, accountId).bags[bagIndex];
  if (bag === undefined) throw new Error('no such bag');
  return { ...bagToForm(bag), ...change };
}

describe('the bag form', () => {
  test('turns every exported bag into form values and back without losing a field', () => {
    const { db } = setup();
    db.exec(
      "INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES (1, randomblob(32), '2026-10-12', '2026-10-12')",
    );
    const document = structuredClone(fixture);
    document.bags[0].personal = {
      private: true,
      state: 'open',
      rating: 3.5,
      rebuy: false,
      note: 'Bright, a little thin',
      bought_on: '2026-09-22',
      price: { cents: 1390, currency: 'EUR' },
      shop: 'nordkaffe.de',
    };
    importBags(db, 1, JSON.stringify(document), { limits: pasteLimits });

    for (const bag of exportBags(db, 1).bags) {
      const parsed = parseBag(formToBag(bagToForm(bag)));
      expect(parsed.ok).toBe(true);
      // The form has no field for the roaster's slug: the roaster is found by name.
      expect(parsed.ok && parsed.value).toEqual({ ...bag, roaster: { name: bag.roaster.name } });
    }
  });

  test('passes a mistyped number on as text, so the contract check names the field', () => {
    const values = { 'coffee.name': 'X', 'roaster.name': 'Nord Kaffe', 'weight.grams': '25O', 'plan.peak.to': '30' };
    const parsed = parseBag(formToBag(values));
    expect(parsed.ok === false && parsed.errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['weight.grams', 'plan.rest.from', 'plan.peak.from']),
    );
  });
});

describe('entering a bag by hand', () => {
  test('saves a typed bag, without a plan, onto the matching pool coffee', async () => {
    const { db, request, me } = await withBags();
    const page = await (await request('/add/manual', { cookie: me.cookie })).text();
    expect(page).toContain('name="coffee.region"');
    expect(page).toContain('aria-current="page">Enter by hand');

    const saved = await request('/add/manual', {
      form: {
        'roaster.name': 'Nord Kaffe',
        'coffee.name': 'Ethiopia Sasaba',
        'coffee.varieties': 'Mixed Heirloom',
        'roast_date.date': '2026-10-01',
        'weight.grams': '250',
        'personal.state': 'open',
        'personal.price.amount': '13,9',
        'personal.price.currency': 'eur',
      },
      cookie: me.cookie,
    });
    expect(saved.status).toBe(303);
    expect(
      db
        .prepare(
          'SELECT coffee_id, source, roast_date, roast_date_status, state, price_cents, currency FROM bag WHERE id = 6',
        )
        .get(),
    ).toEqual({
      coffee_id: 1,
      source: 'manual',
      roast_date: '2026-10-01',
      roast_date_status: 'verified',
      state: 'open',
      price_cents: 1390,
      currency: 'EUR',
    });
  });

  test('names the fields that need a change and keeps what was typed', async () => {
    const { db, request, me } = await withBags();
    const response = await request('/add/manual', {
      form: { 'roaster.name': 'Nord Kaffe', 'coffee.name': 'New Bean', 'weight.grams': '0', 'personal.note': '<b>' },
      cookie: me.cookie,
    });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('<strong>Weight, g:</strong> A whole number above 0');
    expect(html).toContain('value="New Bean"');
    expect(html).toContain('&lt;b&gt;</textarea>');
    expect(count(db, 'bag')).toBe(5);
  });

  test('asks which roaster an unknown name means, and saves once it is picked', async () => {
    const { db, request, me } = await withBags();
    const form = { 'roaster.name': 'Nord Kaffee', 'coffee.name': 'Kenya Kii' };
    const asked = await (await request('/add/manual', { form, cookie: me.cookie })).text();
    expect(asked).toContain('No registered roaster is called “Nord Kaffee”');
    const nord = String(db.prepare("SELECT id FROM roaster WHERE slug = 'nord-kaffe'").get()?.id);
    expect(asked).toContain(`name="roaster_0" value="${nord}"`);

    expect((await request('/add/manual', { form: { ...form, roaster_0: nord }, cookie: me.cookie })).status).toBe(303);
    expect(
      db.prepare("SELECT r.slug FROM coffee c JOIN roaster r ON r.id = c.roaster_id WHERE c.name = 'Kenya Kii'").get(),
    ).toEqual({
      slug: 'nord-kaffe',
    });
  });
});

describe('starting from the pool', () => {
  test("lists pool coffees and the account's own private ones, never another account's", async () => {
    const { db, request, me } = await withBags();
    const secret = structuredClone(fixture.bags[0]);
    secret.coffee.name = 'Secret Sasaba';
    secret.personal = { private: true };
    addBag(db, me.accountId, secret);
    const other = await redeemed(request, db);

    const mine = await (await request('/add/pool', { cookie: me.cookie })).text();
    expect(mine).toContain('Secret Sasaba');
    const theirs = await (await request('/add/pool?q=sasaba', { cookie: other.cookie })).text();
    expect(theirs).toContain('Ethiopia Sasaba');
    expect(theirs).not.toContain('Secret Sasaba');
    const secretId = Number(db.prepare("SELECT id FROM coffee WHERE name = 'Secret Sasaba'").get()?.id);
    expect((await request(`/add/manual?from=${secretId}`, { cookie: other.cookie })).status).toBe(404);
  });

  test('starts the form with the coffee and its roaster, and the saved bag joins that pool coffee', async () => {
    const { db, request } = await withBags();
    const other = await redeemed(request, db);
    const page = await (await request('/add/manual?from=1', { cookie: other.cookie })).text();
    expect(page).toContain('value="Ethiopia Sasaba"');
    expect(page).toContain('value="Nord Kaffe"');
    expect(page).toContain('value="Pineapple, Bergamot, Peach"');
    expect(page).toContain('aria-current="page">Start from the pool');

    const saved = await request('/add/manual', {
      form: {
        from: '1',
        'roaster.name': 'Nord Kaffe',
        'coffee.name': 'Ethiopia Sasaba',
        'coffee.country': 'Ethiopia',
        'coffee.region': 'Guji',
        'coffee.producer': 'Tsegay Hagos Tesgaye',
        'coffee.varieties': 'Mixed Heirloom',
        'coffee.process.category': 'natural',
        'coffee.process.printed': 'Natural',
        'coffee.tasting_notes': 'Pineapple, Bergamot, Peach',
        'weight.grams': '250',
      },
      cookie: other.cookie,
    });
    expect(saved.status).toBe(303);
    expect(db.prepare('SELECT coffee_id FROM bag WHERE account_id = ?').all(other.accountId)).toEqual([
      { coffee_id: 1 },
    ]);
    expect(count(db, 'coffee')).toBe(5);
  });
});

describe('editing a bag', () => {
  test("saves the bag's fields and the pool coffee's facts, logging the fact change", async () => {
    const { db, request, me } = await withBags();
    const page = await (await request('/bags/1/edit', { cookie: me.cookie })).text();
    expect(page).toContain('A change to the bean facts shows for every account');
    expect(page).toContain('value="Guji"');

    const form = editForm(db, me.accountId, 0, { lot: 'Lot 7', 'coffee.region': 'Sidama' });
    const saved = await request('/bags/1/edit', { form, cookie: me.cookie });
    expect([saved.status, saved.headers.get('location')]).toEqual([303, '/bags/1']);
    expect(db.prepare('SELECT lot FROM bag WHERE id = 1').get()).toEqual({ lot: 'Lot 7' });
    expect(db.prepare('SELECT field, new_value FROM coffee_edit').all()).toEqual([
      { field: 'region', new_value: 'Sidama' },
    ]);
  });

  test('a rename onto another coffee of the roaster saves nothing and offers to move the bag there', async () => {
    const { db, request, me } = await withBags();
    const form = editForm(db, me.accountId, 0, { lot: 'Lot 7', 'coffee.name': 'Peru La Danta' });
    const refused = await request('/bags/1/edit', { form, cookie: me.cookie });
    expect(refused.status).toBe(409);
    const html = await refused.text();
    expect(html).toContain('Nord Kaffe already has “Peru La Danta” in the pool');
    expect(html).toContain('name="move_to" value="2"');
    // Enter in a field uses the first button, which must save rather than move.
    expect(/<form[^>]*\/bags\/1\/edit[^>]*>\s*<button type="submit"(?![^>]*move_to)/.test(html)).toBe(true);
    expect(html).toContain('value="Lot 7"');
    expect(db.prepare('SELECT lot, coffee_id FROM bag WHERE id = 1').get()).toEqual({ lot: null, coffee_id: 1 });

    const moved = await request('/bags/1/edit', { form: { ...form, move_to: '2' }, cookie: me.cookie });
    expect(moved.status).toBe(303);
    expect(db.prepare('SELECT lot, coffee_id FROM bag WHERE id = 1').get()).toEqual({ lot: 'Lot 7', coffee_id: 2 });
    expect(db.prepare('SELECT name FROM coffee WHERE id = 1').get()).toEqual({ name: 'Ethiopia Sasaba' });
  });

  test("another account can't open or post the edit form of a bag it doesn't own", async () => {
    const { db, request, me } = await withBags();
    const other = await redeemed(request, db);
    expect((await request('/bags/1/edit', { cookie: other.cookie })).status).toBe(404);
    const form = editForm(db, me.accountId, 0, { 'coffee.region': 'Stolen' });
    expect((await request('/bags/1/edit', { form, cookie: other.cookie })).status).toBe(404);
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Guji' });
  });
});

describe('pasting onto a bag', () => {
  test("fills the bag and leaves the pool's differing facts until Use mine", async () => {
    const { db, request, me } = await withBags();
    const page = await (await request('/bags/1', { cookie: me.cookie })).text();
    expect(page).toContain('href="/bags/1/repaste"');
    expect(page).toContain('href="/bags/1/edit"');

    const document = structuredClone(fixture);
    document.bags = [document.bags[0]];
    document.bags[0].lot = 'Lot 9';
    document.bags[0].coffee.region = 'Sidama';
    const response = await request('/bags/1/repaste', { form: { json: JSON.stringify(document) }, cookie: me.cookie });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Use mine');
    expect(html).toContain('Yours: Sidama');
    expect(db.prepare('SELECT lot FROM bag WHERE id = 1').get()).toEqual({ lot: 'Lot 9' });
    expect(db.prepare('SELECT region FROM coffee WHERE id = 1').get()).toEqual({ region: 'Guji' });
  });

  test('refuses more than one bag, saying why', async () => {
    const { request, me } = await withBags();
    const response = await request('/bags/1/repaste', { form: { json: JSON.stringify(fixture) }, cookie: me.cookie });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Paste one bag at a time onto a bag; this has 5');
  });
});

describe('the rating and notes', () => {
  test('are saved from the bag page, and a rating off the half steps is refused', async () => {
    const { db, request, me } = await withBags();
    const saved = await request('/bags/1/verdict', {
      form: { 'personal.rating': '4.5', 'personal.rebuy': 'yes', 'personal.note': 'Bright' },
      cookie: me.cookie,
    });
    expect([saved.status, saved.headers.get('location')]).toEqual([303, '/bags/1#rating']);
    expect(db.prepare('SELECT rating, rebuy, note, grind FROM bag WHERE id = 1').get()).toEqual({
      rating: 4.5,
      rebuy: 1,
      note: 'Bright',
      grind: '4.2',
    });
    expect(await (await request('/bags/1', { cookie: me.cookie })).text()).toContain('Bright</textarea>');

    const refused = await request('/bags/1/verdict', { form: { 'personal.rating': '4.2' }, cookie: me.cookie });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('<strong>Rating:</strong>');
    const other = await redeemed(request, db);
    expect((await request('/bags/1/verdict', { form: { 'personal.rating': '1' }, cookie: other.cookie })).status).toBe(
      404,
    );
  });
});
