import { describe, expect, test } from 'vitest';
import { addBag } from '../bag/manage.js';
import { fixture, redeemed, setup } from './test-support.js';

/** The fixture with only bag `index`, changed, as pasted text. */
function pasteOf(index: number, change: (bag: Record<string, unknown>) => void = () => {}): string {
  const document = structuredClone(fixture);
  document.bags = [document.bags[index]];
  change(document.bags[0]);
  return JSON.stringify(document);
}

const bagCount = (db: ReturnType<typeof setup>['db']) => Number(db.prepare('SELECT count(*) AS n FROM bag').get()?.n);

describe('pasting a bag', () => {
  test('checks first, saving nothing, and shows what will be saved', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const response = await request('/add/check', { form: { json: pasteOf(0) }, cookie: me.cookie });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Valid beanquery.bags/v1 with 1 bag');
    expect(html).toContain('Registered roaster');
    expect(html).toContain('Ethiopia Sasaba is new to the pool.');
    expect(html).toContain('formaction="/add/save"');
    expect(bagCount(db)).toBe(0);
  });

  test('names the fields that break the contract', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const response = await request('/add/check', {
      form: { json: pasteOf(0, (bag) => ((bag.plan as { mid_peak: number }).mid_peak = 999)) },
      cookie: me.cookie,
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('bags[0].plan.mid_peak');
    expect((await request('/add/check', { form: { json: 'not json' }, cookie: me.cookie })).status).toBe(400);
  });

  test('saves and opens the new bag; the private tick keeps it out of the pool', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const saved = await request('/add/save', { form: { json: pasteOf(0) }, cookie: me.cookie });
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toMatch(/^\/bags\/\d+$/);

    await request('/add/save', { form: { json: pasteOf(1), private_set: 'yes', private: 'yes' }, cookie: me.cookie });
    const owners = db.prepare('SELECT c.name, c.owner_account_id FROM coffee c ORDER BY c.id').all();
    expect(owners).toEqual([
      { name: 'Ethiopia Sasaba', owner_account_id: null },
      { name: 'Peru La Danta', owner_account_id: me.accountId },
    ]);
  });

  test('asks which roaster an unknown name means, keeps the answer, and stores the spelling once saved', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const json = pasteOf(0, (bag) => (bag.roaster = { name: 'Nord Kaffee' }));
    const asked = await (await request('/add/check', { form: { json }, cookie: me.cookie })).text();
    expect(asked).toContain('No registered roaster is called “Nord Kaffee”');
    const nord = Number(db.prepare("SELECT id FROM roaster WHERE slug = 'nord-kaffe'").get()?.id);
    expect(asked).toContain(`name="roaster_0" value="${nord}"`);

    const preview = await (
      await request('/add/check', { form: { json, roaster_0: String(nord) }, cookie: me.cookie })
    ).text();
    expect(preview).toContain('Your pick');
    expect(preview).toContain(`name="roaster_0" value="${nord}"`);
    expect(db.prepare('SELECT count(*) AS n FROM roaster_alias').get()).toEqual({ n: 0 });

    await request('/add/save', { form: { json, roaster_0: String(nord) }, cookie: me.cookie });
    expect(db.prepare('SELECT alias_key FROM roaster_alias').all()).toEqual([{ alias_key: 'nord kaffee' }]);
  });

  test('asks again, without failing, when an answer no longer fits the pasted JSON', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const json = pasteOf(0, (bag) => (bag.roaster = { name: 'Nord Kaffee' }));
    const response = await request('/add/save', { form: { json, roaster_0: '999' }, cookie: me.cookie });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('No registered roaster is called');
    expect(bagCount(db)).toBe(0);
  });

  test('shows facts that differ from the pool after saving, and "Use mine" changes the pool', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    addBag(db, them.accountId, structuredClone(fixture.bags[0]));
    const json = pasteOf(0, (bag) => ((bag.coffee as { region: string }).region = 'Sidama'));

    const saved = await request('/add/save', { form: { json }, cookie: me.cookie });
    const html = await saved.text();
    expect(html).toContain('1 fact differs from the pool coffee');
    expect(html).toContain('Pool: Guji');
    expect(html).toContain('Yours: Sidama');
    const action = /action="(\/coffees\/\d+\/use-mine)"/.exec(html)?.[1] as string;
    const bag = /name="bag" value="(\d+)"/.exec(html)?.[1] as string;

    const used = await request(action, { form: { field: 'region', yours: 'Sidama', bag }, cookie: me.cookie });
    expect([used.status, used.headers.get('location')]).toEqual([303, `/bags/${bag}`]);
    expect(db.prepare("SELECT region FROM coffee WHERE name = 'Ethiopia Sasaba'").get()).toEqual({ region: 'Sidama' });

    const stranger = await redeemed(request, db);
    const refused = await request(action, {
      form: { field: 'region', yours: 'Elsewhere', bag },
      cookie: stranger.cookie,
    });
    expect(refused.status).toBe(404);
    expect((await request(action, { form: { field: 'is_admin', yours: '1' }, cookie: me.cookie })).status).toBe(404);
  });
});

describe('a bag’s actions', () => {
  test('delete goes through a page that names the bag, and needs the confirmation and an own bag', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    addBag(db, me.accountId, structuredClone(fixture.bags[0]));
    const id = Number(db.prepare('SELECT id FROM bag').get()?.id);

    const bagPage = await (await request(`/bags/${id}`, { cookie: me.cookie })).text();
    expect(bagPage).toContain(`<a class="button danger" href="/bags/${id}/delete">Delete bag…</a>`);
    expect(bagPage).toContain('<button class="button secondary" type="submit">Make this bean private</button>');
    const confirmPage = await request(`/bags/${id}/delete`, { cookie: me.cookie });
    const confirmHtml = await confirmPage.text();
    expect(confirmHtml).toContain('Delete Ethiopia Sasaba from Nord Kaffe?');
    expect(confirmHtml).toContain(`action="/bags/${id}/delete"`);
    expect(confirmHtml).toContain('name="confirm" value="yes"');
    expect(confirmHtml).toContain(`href="/bags/${id}"`);
    expect((await request(`/bags/${id}/delete`, { cookie: them.cookie })).status).toBe(404);
    expect(bagCount(db)).toBe(1);

    expect((await request(`/bags/${id}/delete`, { form: {}, cookie: me.cookie })).status).toBe(400);
    expect((await request(`/bags/${id}/delete`, { form: { confirm: 'yes' }, cookie: them.cookie })).status).toBe(404);
    expect(bagCount(db)).toBe(1);
    const deleted = await request(`/bags/${id}/delete`, { form: { confirm: 'yes' }, cookie: me.cookie });
    expect([deleted.status, deleted.headers.get('location')]).toEqual([303, '/']);
    expect(bagCount(db)).toBe(0);
  });

  test('make private and publish move the bean, for its own account only', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    addBag(db, me.accountId, structuredClone(fixture.bags[0]));
    const id = Number(db.prepare('SELECT id FROM bag').get()?.id);
    const owner = () =>
      db
        .prepare('SELECT c.owner_account_id AS owner FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.id = ?')
        .get(id)?.owner;

    expect((await request(`/bags/${id}/private`, { form: {}, cookie: them.cookie })).status).toBe(404);
    expect(owner()).toBeNull();
    expect((await request(`/bags/${id}/private`, { form: {}, cookie: me.cookie })).status).toBe(303);
    expect(owner()).toBe(me.accountId);
    expect((await request(`/bags/${id}/publish`, { form: {}, cookie: me.cookie })).status).toBe(303);
    expect(owner()).toBeNull();
  });
});

describe('importing an export', () => {
  test('brings every bag of an export file into a fresh account, private beans still private', async () => {
    const { db, request } = setup();
    const old = await redeemed(request, db);
    for (const bag of fixture.bags) addBag(db, old.accountId, structuredClone(bag));
    const secret = structuredClone(fixture.bags[1]);
    secret.coffee.name = 'Secret Lot';
    secret.personal = { private: true };
    addBag(db, old.accountId, secret);
    const file = await (await request('/account/export.json', { cookie: old.cookie })).text();

    const fresh = await redeemed(request, db);
    const form = new FormData();
    form.set('file', new File([file], 'beanquery-bags.json', { type: 'application/json' }));
    const response = await request('/import', { multipart: form, cookie: fresh.cookie });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('6 bags were imported.');
    const mine = JSON.parse(await (await request('/account/export.json', { cookie: fresh.cookie })).text());
    expect(mine.bags).toHaveLength(6);
    expect(mine.bags.find((b: { coffee: { name: string } }) => b.coffee.name === 'Secret Lot').personal.private).toBe(
      true,
    );
  });
});

describe('the import’s own body limit', () => {
  test('takes a file over the app’s 1 MB form limit, and refuses one over 21 MB', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const upload = (bytes: number) => {
      const form = new FormData();
      form.set('file', new File(['x'.repeat(bytes)], 'big.json', { type: 'application/json' }));
      return request('/import', { multipart: form, cookie: me.cookie });
    };
    // Past the limit but not JSON: the contract check answers, not the size limit.
    expect((await upload(2 * 1024 * 1024)).status).toBe(400);
    expect((await upload(22 * 1024 * 1024)).status).toBe(413);
    // Other forms keep the 1 MB limit.
    const paste = await request('/add/check', { form: { json: 'x'.repeat(1024 * 1024) }, cookie: me.cookie });
    expect(paste.status).toBe(413);
  });
});

describe('answers carried between steps', () => {
  test('a coffee answer goes from the question through the review to the save', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    addBag(db, them.accountId, structuredClone(fixture.bags[0]));
    const sasaba = Number(db.prepare("SELECT id FROM coffee WHERE name = 'Ethiopia Sasaba'").get()?.id);
    const json = pasteOf(0, (bag) => ((bag.coffee as { name: string }).name = 'Ethiopia Sasaba Lot 2'));

    const asked = await (await request('/add/check', { form: { json }, cookie: me.cookie })).text();
    expect(asked).toContain('Is “Ethiopia Sasaba Lot 2” one of these coffees?');
    expect(asked).toContain(`name="coffee_0" value="${sasaba}"`);

    const review = await (
      await request('/add/check', { form: { json, coffee_0: String(sasaba) }, cookie: me.cookie })
    ).text();
    expect(review).toContain('is already in the pool');
    expect(review).toContain(`<input type="hidden" name="coffee_0" value="${sasaba}"/>`);

    await request('/add/save', { form: { json, coffee_0: String(sasaba) }, cookie: me.cookie });
    expect(db.prepare('SELECT coffee_id FROM bag WHERE account_id = ?').get(me.accountId)).toEqual({
      coffee_id: sasaba,
    });
  });

  test('the private tick survives a round of questions', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const json = pasteOf(0, (bag) => (bag.roaster = { name: 'Nord Kaffee' }));
    const html = await (
      await request('/add/save', {
        form: { json, roaster_0: '999', private_set: 'yes', private: 'yes' },
        cookie: me.cookie,
      })
    ).text();
    expect(html).toContain('No registered roaster is called');
    expect(html).toContain('<input type="hidden" name="private_set" value="yes"/>');
    expect(html).toContain('<input type="hidden" name="private" value="yes"/>');

    const nord = Number(db.prepare("SELECT id FROM roaster WHERE slug = 'nord-kaffe'").get()?.id);
    await request('/add/save', {
      form: { json, roaster_0: String(nord), private_set: 'yes', private: 'yes' },
      cookie: me.cookie,
    });
    expect(db.prepare('SELECT owner_account_id FROM coffee').all()).toEqual([{ owner_account_id: me.accountId }]);
  });

  test('publishing asks which close pool coffee the bean is, and moves the bag there', async () => {
    const { db, request } = setup();
    const me = await redeemed(request, db);
    const them = await redeemed(request, db);
    addBag(db, them.accountId, structuredClone(fixture.bags[0]));
    const sasaba = Number(db.prepare("SELECT id FROM coffee WHERE name = 'Ethiopia Sasaba'").get()?.id);
    const mine = structuredClone(fixture.bags[0]);
    mine.coffee.name = 'Ethiopia Sasaba Lot 2';
    mine.personal = { private: true };
    addBag(db, me.accountId, mine);
    const bagId = Number(db.prepare('SELECT id FROM bag WHERE account_id = ?').get(me.accountId)?.id);

    const asked = await (await request(`/bags/${bagId}/publish`, { form: {}, cookie: me.cookie })).text();
    expect(asked).toContain('Is “Ethiopia Sasaba Lot 2” one of these pool coffees?');
    expect(asked).toContain(`name="coffee" value="${sasaba}"`);

    const moved = await request(`/bags/${bagId}/publish`, { form: { coffee: String(sasaba) }, cookie: me.cookie });
    expect(moved.status).toBeLessThan(400);
    expect(db.prepare('SELECT coffee_id FROM bag WHERE id = ?').get(bagId)).toEqual({ coffee_id: sasaba });
  });
});
