import { describe, expect, test } from 'vitest';
import { createInvite } from '../account/account.js';
import { fixture, numberPattern, sessionCookie, setup } from './test-support.js';

/**
 * What a browser would post from a page's form: text and date inputs and hidden fields with their values, each
 * select's selected option (or its first), each textarea's text, and ticked checkboxes. Enough for this app's forms,
 * whose markup it knows.
 */
function formValues(html: string): Record<string, string> {
  const decode = (text: string) =>
    text
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  const values: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
    const name = attribute('name');
    const type = attribute('type') ?? 'text';
    if (name === undefined || type === 'submit' || type === 'file') continue;
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/.test(tag)) continue;
    values[name] = decode(attribute('value') ?? '');
  }
  for (const [, name, options] of html.matchAll(/<select\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const option =
      /<option value="([^"]*)" selected/.exec(options ?? '') ?? /<option value="([^"]*)"/.exec(options ?? '');
    values[name as string] = decode(option?.[1] ?? '');
  }
  for (const [, name, text] of html.matchAll(/<textarea\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    values[name as string] = decode(text ?? '');
  }
  return values;
}

/**
 * The plan's end-to-end check of the web layer, through HTTP only, as a browser would drive it: redeem, paste with
 * review, the saved rows and dates, the pool, a due toast, edit, publish, delete, and export into a new account.
 */
describe('end to end', () => {
  test('redeem, paste and review, toast, edit, publish, delete, and an export that imports into a new account', async () => {
    const { db, clock, request } = setup();

    // 1. Redeem an invite, in Berlin's time zone, as the browser reports it.
    const { code } = createInvite(db, clock.now);
    const redeemedPage = await request('/redeem', { form: { code, time_zone: 'Europe/Berlin' } });
    expect(numberPattern.test(await redeemedPage.text())).toBe(true);
    const cookie = sessionCookie(redeemedPage) as string;

    // 2. Paste each fixture bag: check first, which saves nothing, then save. Peru La Danta is kept private.
    const bagIds: number[] = [];
    for (const [index, bag] of fixture.bags.entries()) {
      const json = JSON.stringify({ ...fixture, bags: [bag] });
      const review = await request('/add/check', { form: { json }, cookie });
      expect(await review.text()).toContain('Valid beanquery.bags/v1 with 1 bag');
      const answers = index === 1 ? { private_set: 'yes', private: 'yes' } : { private_set: 'yes' };
      const saved = await request('/add/save', { form: { json, ...answers }, cookie });
      expect(saved.status).toBe(303);
      bagIds.push(Number(/\/bags\/(\d+)$/.exec(saved.headers.get('location') ?? '')?.[1]));
    }
    const [sasaba, danta, elida, audaura] = bagIds as [number, number, number, number, number];

    // 3. The saved rows, the computed dates, and the private bean kept out of the pool.
    const library = await (await request('/', { cookie })).text();
    expect(library).toContain('5 bags');
    const elidaPage = await (await request(`/bags/${elida}`, { cookie })).text();
    expect(elidaPage).toContain('13 to 16 Oct'); // Rest, +25 to +28 from 18 September.
    expect(elidaPage).toContain('16 Oct to 12 Nov'); // Peak, +28 to +55.
    expect(elidaPage).toContain('Keep sealed. Open, portion and freeze between 13 October and 16 October.');
    const friendInvite = createInvite(db, clock.now).code;
    const friend = sessionCookie(await request('/redeem', { form: { code: friendInvite } })) as string;
    const pool = await (await request('/pool', { cookie: friend })).text();
    expect(pool).toContain('Ethiopia Sasaba');
    expect(pool).not.toContain('Peru La Danta');

    // 4. Elida's portion day is coming up, then due as a toast with "Done: frozen", which clears it. (Sasaba's and
    // Peru La Danta's portion days have passed, so their toasts show throughout.)
    const elidaToast = `<form method="post" action="/bags/${elida}/state"`;
    expect(library).toContain('Coming up');
    expect(library).not.toContain(elidaToast);
    clock.now = new Date('2026-10-13T08:00:00Z');
    expect(await (await request('/', { cookie })).text()).toContain(elidaToast);
    await request(`/bags/${elida}/state`, { form: { state: 'frozen', from: 'library' }, cookie });
    expect(await (await request('/', { cookie })).text()).not.toContain(elidaToast);

    // Edit one bag: its lot, and its pool coffee's region, which every account sees.
    const fields = formValues(await (await request(`/bags/${sasaba}/edit`, { cookie })).text());
    expect(fields['coffee.process.category']).toBe('natural');
    const edited = await request(`/bags/${sasaba}/edit`, {
      form: { ...fields, lot: 'Lot 7', 'coffee.region': 'Uraga', 'personal.state': 'open' },
      cookie,
    });
    expect(edited.status).toBe(303);
    expect(await (await request('/pool?q=uraga', { cookie: friend })).text()).toContain('Ethiopia Sasaba');
    // Only the changed fact is logged: the form sends every other fact back as it was.
    expect(db.prepare('SELECT field FROM coffee_edit').all()).toEqual([{ field: 'region' }]);

    // Rate it, publish the private bean after all, and delete another bag.
    await request(`/bags/${sasaba}/verdict`, { form: { 'personal.rating': '4.5', 'personal.note': 'Bright' }, cookie });
    await request(`/bags/${danta}/publish`, { form: {}, cookie });
    expect(await (await request('/pool', { cookie: friend })).text()).toContain('Peru La Danta');
    await request(`/bags/${danta}/private`, { form: {}, cookie });
    expect((await request(`/bags/${audaura}/delete`, { form: { confirm: 'yes' }, cookie })).status).toBe(303);
    expect(await (await request('/', { cookie })).text()).toContain('4 bags');

    // 5. Export, import into a new account, and compare: every contract field, the private bean included.
    const exported = await (await request('/account/export.json', { cookie })).text();
    const newcomer = sessionCookie(await request('/redeem', { form: { code: createInvite(db, clock.now).code } }));
    const upload = new FormData();
    upload.set('file', new File([exported], 'export.json', { type: 'application/json' }));
    const imported = await request('/import', { multipart: upload, cookie: newcomer as string });
    expect(await imported.text()).toContain('4 bags were imported.');
    const reexported = await (await request('/account/export.json', { cookie: newcomer as string })).text();
    expect(JSON.parse(reexported)).toEqual(JSON.parse(exported));
    const document = JSON.parse(reexported) as { bags: { coffee: { name: string }; personal: { private: boolean } }[] };
    expect(document.bags.filter((bag) => bag.personal.private).map((bag) => bag.coffee.name)).toEqual([
      'Peru La Danta',
    ]);
    // Published once, Peru La Danta's pool coffee stays for others; neither account's bag of it is on it any more.
    expect(
      db
        .prepare(
          `SELECT count(*) AS n FROM bag b JOIN coffee c ON c.id = b.coffee_id
           WHERE c.name = 'Peru La Danta' AND c.owner_account_id IS NULL`,
        )
        .get(),
    ).toEqual({ n: 0 });

    // Finally, delete the account.
    const gone = await request('/account/delete', { form: { confirm: 'yes' }, cookie });
    expect(gone.status).toBe(200);
    expect((await request('/', { cookie })).status).toBe(303);
  });
});
