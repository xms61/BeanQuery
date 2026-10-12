import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BagPreview, CoffeeChoice, CoffeeQuestion, Difference, RoasterQuestion } from '../../bag/import.js';
import { importBags } from '../../bag/import.js';
import { bagDetail } from '../../bag/library.js';
import { useMine } from '../../coffee/edit.js';
import {
  type ContractBag,
  type ContractError,
  exportLimits,
  parseBagsJson,
  pasteLimits,
} from '../../contract/bag-json.js';
import { AddTabs } from '../components.js';
import { type Env, requireAccount, todayFor } from '../context.js';
import { origin, processLabel } from '../format.js';
import { AppPage } from '../layout.js';

/** Adding bags by pasting JSON (check, answer questions, save), "Use mine", and importing an export file. */
export const addRoutes = new Hono<Env>();

/** The answers a form carries: roaster and coffee picks by bag index, and the private tick, if the review set it. */
export interface Answers {
  roasters: Record<number, number>;
  coffees: Record<number, CoffeeChoice>;
  private: boolean | undefined;
}

addRoutes.get('/add', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  return c.html(<AddPage admin={c.var.admin} json="" answers={{ roasters: {}, coffees: {}, private: undefined }} />);
});

for (const step of ['check', 'save'] as const) {
  addRoutes.post(`/add/${step}`, async (c) => {
    const accountId = requireAccount(c);
    if (accountId instanceof Response) return accountId;
    const body = await c.req.parseBody();
    const json = typeof body.json === 'string' ? body.json : '';
    const answers = readAnswers(body);
    const result = importBags(c.var.config.db, accountId, withPrivate(json, answers.private), {
      limits: pasteLimits,
      roasterChoices: answers.roasters,
      coffeeChoices: answers.coffees,
      preview: step === 'check',
    });
    if (result.status === 'saved') {
      if (result.differences.length === 0) {
        return c.redirect(result.bagIds.length === 1 ? `/bags/${result.bagIds[0]}` : '/', 303);
      }
      return c.html(<SavedPage c={c} accountId={accountId} bagIds={result.bagIds} differences={result.differences} />);
    }
    return c.html(
      <AddPage admin={c.var.admin} json={json} answers={answers} result={result} />,
      result.status === 'invalid' ? 400 : 200,
    );
  });
}

addRoutes.post('/coffees/:id/use-mine', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const body = await c.req.parseBody();
  const field = typeof body.field === 'string' ? body.field : '';
  const yours = typeof body.yours === 'string' ? body.yours : null;
  const coffeeId = positive(c.req.param('id'));
  if (!fieldLabels[field]) return c.notFound();
  const result = useMine(c.var.config.db, accountId, coffeeId, field, body.cleared === 'yes' ? null : yours);
  if (result.status === 'not_found' || result.status === 'not_allowed') return c.notFound();
  if (result.status !== 'saved') return c.text('That value can no longer be used here.', 409);
  const bagId = positive(typeof body.bag === 'string' ? body.bag : '');
  return c.redirect(bagId > 0 ? `/bags/${bagId}` : '/', 303);
});

// An export can be up to 20 MB, more than the app's 1 MB for other forms.
addRoutes.post(
  '/import',
  bodyLimit({
    maxSize: 21 * 1024 * 1024,
    onError: (c) => c.text('That file is larger than an export can be (20 MB).', 413),
  }),
  async (c) => {
    const accountId = requireAccount(c);
    if (accountId instanceof Response) return accountId;
    const body = await c.req.parseBody();
    const json = body.file instanceof File ? await body.file.text() : typeof body.json === 'string' ? body.json : '';
    const answers = readAnswers(body);
    const result = importBags(c.var.config.db, accountId, json, {
      limits: exportLimits,
      roasterChoices: answers.roasters,
      coffeeChoices: answers.coffees,
    });
    if (result.status === 'saved') {
      return c.html(
        <AppPage title="Imported" section="account" admin={c.var.admin}>
          <h1>Imported</h1>
          <p>{result.bagIds.length === 1 ? '1 bag was imported.' : `${result.bagIds.length} bags were imported.`}</p>
          {result.differences.length > 0 && (
            <Differences c={c} accountId={accountId} bagIds={result.bagIds} differences={result.differences} />
          )}
          <a class="button" href="/">
            To the library
          </a>
        </AppPage>,
      );
    }
    return c.html(
      <AppPage title="Import" section="account" admin={c.var.admin}>
        <h1>Import an export</h1>
        {/* Multipart, so the export goes back at its own size; URL-encoding could triple it past the limit. */}
        <form method="post" action="/import" enctype="multipart/form-data" class="card">
          <textarea name="json" hidden>
            {json}
          </textarea>
          <Outcome result={result} answers={answers} />
          {result.status !== 'invalid' && (
            <button class="button" type="submit">
              Import
            </button>
          )}
        </form>
      </AppPage>,
      result.status === 'invalid' ? 400 : 200,
    );
  },
);

/** Reads `roaster_<index>`, `coffee_<index>` and `private` from a posted form. */
export function readAnswers(body: Record<string, unknown>): Answers {
  const answers: Answers = { roasters: {}, coffees: {}, private: undefined };
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string') continue;
    const match = /^(roaster|coffee)_(\d{1,4})$/.exec(key);
    if (match === null) continue;
    const index = Number(match[2]);
    if (match[1] === 'roaster' && /^[1-9]\d{0,15}$/.test(value)) answers.roasters[index] = Number(value);
    if (match[1] === 'coffee' && (value === 'new' || /^[1-9]\d{0,15}$/.test(value))) {
      answers.coffees[index] = value === 'new' ? 'new' : Number(value);
    }
  }
  if (body.private_set === 'yes') answers.private = body.private === 'yes';
  return answers;
}

/** The pasted document with every bag's private flag set from the review's tick, when the review sent one. */
function withPrivate(json: string, isPrivate: boolean | undefined): string {
  if (isPrivate === undefined) return json;
  try {
    const document: unknown = JSON.parse(json);
    if (typeof document !== 'object' || document === null || !Array.isArray((document as { bags?: unknown }).bags)) {
      return json;
    }
    for (const bag of (document as { bags: unknown[] }).bags) {
      if (typeof bag !== 'object' || bag === null) continue;
      const record = bag as Record<string, unknown>;
      const personal = typeof record.personal === 'object' && record.personal !== null ? record.personal : {};
      record.personal = { ...personal, private: isPrivate };
    }
    return JSON.stringify(document);
  } catch {
    // Not JSON: the contract check reports it.
    return json;
  }
}

const positive = (value: string | undefined) => (/^[1-9]\d{0,15}$/.test(value ?? '') ? Number(value) : 0);

type Outcome =
  | { status: 'preview'; bags: BagPreview[]; differences: Difference[] }
  | { status: 'needs_roaster'; bags: RoasterQuestion[] }
  | { status: 'needs_coffee'; bags: CoffeeQuestion[] }
  | { status: 'invalid'; errors: ContractError[] };

function AddPage(props: { admin: boolean; json: string; answers: Answers; result?: Outcome }) {
  const { result } = props;
  const parsed = result?.status === 'preview' ? parseBagsJson(props.json, pasteLimits) : undefined;
  const bags = parsed?.ok ? parsed.value.bags : [];
  const isPrivate = props.answers.private ?? (bags.length > 0 && bags.every((bag) => bag.personal?.private === true));
  return (
    <AppPage title="Add bag" section="add" admin={props.admin}>
      <div class="page-head">
        <h1>Add bag</h1>
      </div>
      <AddTabs current="paste" />
      <form method="post" action="/add/check" class="add-grid">
        <section class="card">
          <label class="field">
            Paste the JSON block your LLM wrote after the plan.
            <textarea name="json" class="code" rows={28} spellcheck={false} required>
              {props.json}
            </textarea>
          </label>
          {result?.status === 'preview' && (
            <p class="ok small">
              Valid beanquery.bags/v1 with {result.bags.length === 1 ? '1 bag' : `${result.bags.length} bags`}
            </p>
          )}
          <button class="button secondary" type="submit">
            Check
          </button>
        </section>
        {result !== undefined && (
          <section class="card">
            <Outcome result={result} answers={props.answers} />
            {result.status === 'preview' && (
              <>
                {bags.map((bag, index) => (
                  <BagSummary bag={bag} preview={result.bags[index]} />
                ))}
                {result.differences.length > 0 && <DifferencesNote differences={result.differences} />}
                <input type="hidden" name="private_set" value="yes" />
                <label class="check">
                  <input type="checkbox" name="private" value="yes" checked={isPrivate} /> Keep this bean private
                </label>
                <p class="muted small">
                  Leave it unticked to add the bean facts to the pool. Your roast date, plan, water, grind, notes and
                  rating are never shared; only your rating counts, without your account, toward the collective rating.
                </p>
                <div class="actions">
                  <button class="button" type="submit" formaction="/add/save">
                    {bags.length === 1 ? 'Save bag' : `Save ${bags.length} bags`}
                  </button>
                  <a class="button quiet" href="/add">
                    Cancel
                  </a>
                </div>
              </>
            )}
          </section>
        )}
      </form>
    </AppPage>
  );
}

/** The errors, the questions with the earlier answers kept, or nothing for a preview (shown by the caller). */
export function Outcome(props: { result: Outcome; answers: Answers }) {
  const { result, answers } = props;
  const kept = (
    <>
      {Object.entries(answers.roasters).map(([index, id]) =>
        result.status === 'needs_roaster' && result.bags.some((q) => q.index === Number(index)) ? null : (
          <input type="hidden" name={`roaster_${index}`} value={String(id)} />
        ),
      )}
      {Object.entries(answers.coffees).map(([index, choice]) =>
        result.status === 'needs_coffee' && result.bags.some((q) => q.index === Number(index)) ? null : (
          <input type="hidden" name={`coffee_${index}`} value={String(choice)} />
        ),
      )}
      {answers.private !== undefined && result.status !== 'preview' && (
        <>
          <input type="hidden" name="private_set" value="yes" />
          {answers.private && <input type="hidden" name="private" value="yes" />}
        </>
      )}
    </>
  );
  if (result.status === 'invalid') {
    return (
      <div class="problem">
        <h2>The JSON doesn't fit the contract</h2>
        <ul class="small">
          {result.errors.map((error) => (
            <li>
              {error.path !== '' && <code>{error.path}</code>} {error.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (result.status === 'needs_roaster') {
    return (
      <>
        {kept}
        {result.bags.map((question) => (
          <fieldset class="question">
            <legend>
              {question.reason === 'unknown'
                ? `No registered roaster is called “${question.entered}”`
                : `Several roasters are called “${question.entered}”`}
            </legend>
            <p class="muted small">
              Pick the right one so the bean joins its roaster. Nothing is saved until the roaster is set.
            </p>
            {question.candidates.map((roaster) => (
              <label class="choice">
                <input type="radio" name={`roaster_${question.index}`} value={String(roaster.id)} required />
                <span>
                  <strong>{roaster.name}</strong>
                  <span class="muted small">
                    {roaster.source === 'every_coffee'
                      ? ` every.coffee/roaster/${roaster.slug}`
                      : ' added by the admin'}
                  </span>
                </span>
              </label>
            ))}
            {question.candidates.length === 0 && (
              <p class="muted">No roaster has a similar name. Not on every.coffee? Ask the admin to add it.</p>
            )}
          </fieldset>
        ))}
        <button class="button" type="submit">
          Use these roasters
        </button>
      </>
    );
  }
  if (result.status === 'needs_coffee') {
    return (
      <>
        {kept}
        {result.bags.map((question) => (
          <fieldset class="question">
            <legend>Is “{question.entered}” one of these coffees?</legend>
            <p class="muted small">
              A coffee with a close name is already there. Pick it, or keep yours as a new coffee.
            </p>
            {question.candidates.map((coffee) => (
              <label class="choice">
                <input type="radio" name={`coffee_${question.index}`} value={String(coffee.id)} required />
                <span>
                  <strong>{coffee.name}</strong>
                  <span class="muted small">{coffee.private ? ' your private coffee' : ' in the pool'}</span>
                </span>
              </label>
            ))}
            <label class="choice">
              <input type="radio" name={`coffee_${question.index}`} value="new" required />
              <span>
                <strong>A new coffee</strong>
              </span>
            </label>
          </fieldset>
        ))}
        <button class="button" type="submit">
          Use these coffees
        </button>
      </>
    );
  }
  return kept;
}

const coffeeOutcome: Record<BagPreview['coffee'], (name: string) => string> = {
  joins_pool: (name) =>
    `${name} is already in the pool. Your bag links to it, and facts the pool is missing are filled from yours.`,
  new_pool: (name) => `${name} is new to the pool. Its bean facts become visible to every account.`,
  joins_private: (name) => `${name} is already one of your private coffees. Your bag joins it.`,
  new_private: (name) => `${name} becomes a private coffee that only you see.`,
};

function BagSummary(props: { bag: ContractBag; preview: BagPreview | undefined }) {
  const { bag, preview } = props;
  const water = bag.brew.water;
  return (
    <div class="bag-summary">
      {preview && (
        <div class="callout">
          <strong>{preview.roaster}</strong>{' '}
          <span class="pill quiet">
            {preview.roasterMatch === 'name'
              ? 'Registered roaster'
              : preview.roasterMatch === 'alias'
                ? 'Matched by a known spelling'
                : 'Your pick'}
          </span>
          <p class="muted small">{coffeeOutcome[preview.coffee](bag.coffee.name)}</p>
        </div>
      )}
      <h2>Bean facts</h2>
      <table class="rows">
        <tbody>
          <Row label="Coffee" value={bag.coffee.name} />
          <Row label="Country and region" value={origin(bag.coffee.country, bag.coffee.region)} />
          <Row label="Producer" value={[bag.coffee.producer, bag.coffee.farm].filter(Boolean).join(', ')} />
          <Row label="Varieties" value={bag.coffee.varieties.join(', ')} />
          <Row
            label="Process"
            value={
              bag.coffee.process.printed ?? (bag.coffee.process.category && processLabel(bag.coffee.process.category))
            }
          />
          <Row label="Altitude" value={bag.coffee.altitude.printed} />
          <Row label="Roaster's notes" value={bag.coffee.tasting_notes.join(', ')} />
          <Row label="Harvest" value={bag.harvest} />
        </tbody>
      </table>
      <h2>Your bag</h2>
      <table class="rows">
        <tbody>
          <Row
            label="Roast date"
            value={
              bag.roast_date.date === null
                ? `${bag.roast_date.status}${bag.roast_date.printed ? ` (printed ${bag.roast_date.printed})` : ''}`
                : `${bag.roast_date.date}${bag.roast_date.printed ? ` (printed ${bag.roast_date.printed})` : ''}`
            }
          />
          <Row
            label="Roast degree"
            value={bag.roast.degree && `${processLabel(bag.roast.degree)}${bag.roast.assumed ? ', assumed' : ''}`}
          />
          <Row
            label="Weight"
            value={bag.weight.grams === null ? null : `${bag.weight.grams} g${bag.weight.assumed ? ', assumed' : ''}`}
          />
          <Row
            label="Plan"
            value={
              bag.plan &&
              `Rest +${bag.plan.rest.from} to +${bag.plan.rest.to}, peak +${bag.plan.peak.from} to +${bag.plan.peak.to}`
            }
          />
          <Row label="Water, GH and KH" value={water && `${water.gh} and ${water.kh} ppm as CaCO3`} />
          <Row
            label="Alternative water"
            value={bag.brew.water_alt && `${bag.brew.water_alt.gh} and ${bag.brew.water_alt.kh} ppm as CaCO3`}
          />
          <Row label="Kettle" value={bag.brew.kettle_c === null ? null : `${bag.brew.kettle_c} °C`} />
          <Row label="Grinder" value={bag.brew.grinder} />
          <Row label="Grind" value={bag.brew.grind} />
        </tbody>
      </table>
    </div>
  );
}

function Row(props: { label: string; value: string | null | undefined | false }) {
  return (
    <tr>
      <th>{props.label}</th>
      <td class={props.value ? undefined : 'muted'}>{props.value || 'Not stated'}</td>
    </tr>
  );
}

export const fieldLabels: Record<string, string> = {
  name: 'Coffee',
  country: 'Country',
  region: 'Region',
  farm: 'Farm',
  producer: 'Producer',
  process_printed: 'Process, as printed',
  process_category: 'Process',
  altitude_printed: 'Altitude, as printed',
  altitude_min_m: 'Altitude from',
  altitude_max_m: 'Altitude to',
  decaf: 'Decaf',
  varieties: 'Varieties',
  tasting_notes: "Roaster's notes",
};

/** A difference's value for people: lists as comma-separated text, nothing as "Not stated". */
function shown(value: string | null): string {
  if (value === null) return 'Not stated';
  if (value.startsWith('[')) {
    try {
      const list: unknown = JSON.parse(value);
      if (Array.isArray(list)) return list.join(', ') || 'None';
    } catch {
      // Shown as it is.
    }
  }
  return value;
}

function DifferencesNote(props: { differences: Difference[] }) {
  return (
    <div class="callout">
      <strong>
        {props.differences.length === 1 ? '1 fact differs' : `${props.differences.length} facts differ`} from the pool
        coffee
      </strong>
      <p class="muted small">
        The pool keeps its values. After saving, you can use yours instead, which changes it for every account.
      </p>
    </div>
  );
}

export function Differences(props: {
  c: Context<Env>;
  accountId: number;
  bagIds: number[];
  differences: Difference[];
}) {
  const today = todayFor(props.c, props.accountId);
  return (
    <section class="card">
      <h2>
        {props.differences.length === 1 ? '1 fact differs' : `${props.differences.length} facts differ`} from the pool
        coffee
      </h2>
      <p class="muted small">
        The pool keeps its values. Use yours to change it for every account; the change is logged. Gaps in the pool were
        filled from your paste.
      </p>
      <table class="rows">
        <tbody>
          {props.differences.map((difference) => {
            const bagId = props.bagIds[difference.index] ?? 0;
            const coffeeId = bagDetail(props.c.var.config.db, props.accountId, bagId, today)?.coffeeId ?? 0;
            return (
              <tr>
                <th>{fieldLabels[difference.field] ?? difference.field}</th>
                <td>
                  <strong>Pool: {shown(difference.pool)}</strong>
                  <div class="muted small">Yours: {shown(difference.yours)}</div>
                </td>
                <td>
                  <form method="post" action={`/coffees/${coffeeId}/use-mine`}>
                    <input type="hidden" name="field" value={difference.field} />
                    {difference.yours === null ? (
                      <input type="hidden" name="cleared" value="yes" />
                    ) : (
                      <input type="hidden" name="yours" value={difference.yours} />
                    )}
                    <input type="hidden" name="bag" value={String(bagId)} />
                    <button class="button secondary" type="submit">
                      Use mine
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function SavedPage(props: { c: Context<Env>; accountId: number; bagIds: number[]; differences: Difference[] }) {
  return (
    <AppPage title="Saved" section="add" admin={props.c.var.admin}>
      <h1>Saved</h1>
      <p>{props.bagIds.length === 1 ? 'Your bag is saved.' : `${props.bagIds.length} bags are saved.`}</p>
      <Differences c={props.c} accountId={props.accountId} bagIds={props.bagIds} differences={props.differences} />
      <div class="actions">
        <a class="button" href={props.bagIds.length === 1 ? `/bags/${props.bagIds[0]}` : '/'}>
          {props.bagIds.length === 1 ? 'Open the bag' : 'To the library'}
        </a>
      </div>
    </AppPage>
  );
}
