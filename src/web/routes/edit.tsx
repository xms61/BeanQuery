import { type Context, Hono } from 'hono';
import type { ImportResult } from '../../bag/import.js';
import { bagDetail } from '../../bag/library.js';
import { addBag, type BagEditResult, rateBag, saveBagEdit } from '../../bag/manage.js';
import { type RepasteResult, repasteBag } from '../../bag/repaste.js';
import { readCoffee } from '../../coffee/edit.js';
import { searchPool, startingPoint } from '../../coffee/search.js';
import { BagFormFields, bagToForm, FormErrors, type FormValues, formToBag, formToEdit, readForm } from '../bag-form.js';
import { AddTabs } from '../components.js';
import { type Env, requireAccount, todayFor } from '../context.js';
import { origin, processLabel } from '../format.js';
import { AppPage } from '../layout.js';
import { type Answers, Differences, Outcome, readAnswers, SavedPage } from './add.js';

/** Entering a bag by hand or from the pool, editing a bag and its coffee, pasting onto a bag, and the verdict. */
export const editRoutes = new Hono<Env>();

const positive = (value: unknown) => (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : 0);
const bagIdOf = (c: Context<Env>) => positive(c.req.param('id'));
const noAnswers: Answers = { roasters: {}, coffees: {}, private: undefined };

editRoutes.get('/add/manual', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const from = positive(c.req.query('from'));
  const start = from > 0 ? startingPoint(c.var.config.db, accountId, from) : undefined;
  if (from > 0 && start === undefined) return c.notFound();
  const values: FormValues = { 'personal.state': 'sealed' };
  if (start !== undefined) {
    Object.assign(values, bagToForm({ ...emptyBag, roaster: { name: start.roaster }, coffee: start.coffee }), {
      'personal.state': 'sealed',
    });
    if (start.private) values['personal.private'] = 'yes';
  }
  return c.html(<ManualPage admin={c.var.admin} values={values} answers={noAnswers} from={start} fromId={from} />);
});

editRoutes.post('/add/manual', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const body = await c.req.parseBody();
  const values = readForm(body);
  const answers = readAnswers(body);
  const from = positive(body.from);
  const start = from > 0 ? startingPoint(c.var.config.db, accountId, from) : undefined;
  const result = addBag(c.var.config.db, accountId, formToBag(values), {
    ...(answers.roasters[0] === undefined ? {} : { roasterChoice: answers.roasters[0] }),
    ...(answers.coffees[0] === undefined ? {} : { coffeeChoice: answers.coffees[0] }),
  });
  if (result.status === 'saved') {
    if (result.differences.length === 0) return c.redirect(`/bags/${result.bagIds[0]}`, 303);
    return c.html(<SavedPage c={c} accountId={accountId} bagIds={result.bagIds} differences={result.differences} />);
  }
  return c.html(
    <ManualPage admin={c.var.admin} values={values} answers={answers} result={result} from={start} fromId={from} />,
    result.status === 'invalid' ? 400 : 200,
  );
});

editRoutes.get('/add/pool', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const query = (c.req.query('q') ?? '').slice(0, 200);
  const coffees = searchPool(c.var.config.db, accountId, { query, includeOwnPrivate: true });
  const shown = coffees.slice(0, 100);
  return c.html(
    <AppPage title="Add bag" section="add" admin={c.var.admin}>
      <div class="page-head">
        <h1>Add bag</h1>
      </div>
      <AddTabs current="pool" />
      <form method="get" action="/add/pool" class="filters">
        <input name="q" value={query} placeholder="Find a coffee in the pool" aria-label="Find a coffee" />
        <button class="button secondary" type="submit">
          Search
        </button>
        <span class="muted small">The bean facts come from the pool; you add your own bag.</span>
      </form>
      {shown.length === 0 ? (
        <section class="card">
          <p class="muted">{query === '' ? 'The pool is empty so far.' : 'No coffee matches.'}</p>
        </section>
      ) : (
        <section class="card table-card">
          <table class="library">
            <thead>
              <tr>
                <th>Coffee</th>
                <th>Origin</th>
                <th>Process</th>
                <th>Harvests</th>
                <th>
                  <span class="visually-hidden">Start</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((coffee) => (
                <tr>
                  <td>
                    <strong>{coffee.name}</strong>
                    <div class="muted small">
                      {coffee.roaster}
                      {coffee.private ? ' · your private coffee' : ''}
                    </div>
                  </td>
                  <td>{origin(coffee.country, coffee.region)}</td>
                  <td>{coffee.process === null ? '' : processLabel(coffee.process)}</td>
                  <td class="muted">{coffee.harvests.join(', ') || 'Not listed'}</td>
                  <td>
                    <a class="button secondary" href={`/add/manual?from=${coffee.coffeeId}`}>
                      Start a bag
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {coffees.length > shown.length && (
        <p class="muted small">
          Showing {shown.length} of {coffees.length}. Search to narrow the list.
        </p>
      )}
      <div class="callout">
        <strong>Your private beans show here too, only to you.</strong>
        <p class="muted small">Starting from one of your private coffees keeps the new bag private.</p>
      </div>
    </AppPage>,
  );
});

editRoutes.get('/bags/:id/edit', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const detail = bagDetail(c.var.config.db, accountId, bagIdOf(c), todayFor(c, accountId));
  if (detail === undefined) return c.notFound();
  return c.html(<EditPage c={c} detail={detail} values={bagToForm(detail.bag)} />);
});

editRoutes.post('/bags/:id/edit', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const bagId = bagIdOf(c);
  const detail = bagDetail(c.var.config.db, accountId, bagId, todayFor(c, accountId));
  if (detail === undefined) return c.notFound();
  const body = await c.req.parseBody();
  const values = readForm(body);
  const moveTo = positive(body.move_to);
  const result = saveBagEdit(c.var.config.db, accountId, bagId, formToEdit(values), moveTo > 0 ? { moveTo } : {});
  if (result.status === 'saved') return c.redirect(`/bags/${bagId}`, 303);
  if (result.status === 'not_found') return c.notFound();
  return c.html(
    <EditPage c={c} detail={detail} values={values} result={result} />,
    result.status === 'invalid' ? 400 : 409,
  );
});

editRoutes.get('/bags/:id/repaste', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const detail = bagDetail(c.var.config.db, accountId, bagIdOf(c), todayFor(c, accountId));
  if (detail === undefined) return c.notFound();
  return c.html(<RepastePage admin={c.var.admin} detail={detail} json="" answers={noAnswers} />);
});

editRoutes.post('/bags/:id/repaste', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const bagId = bagIdOf(c);
  const detail = bagDetail(c.var.config.db, accountId, bagId, todayFor(c, accountId));
  if (detail === undefined) return c.notFound();
  const body = await c.req.parseBody();
  const json = typeof body.json === 'string' ? body.json : '';
  const answers = readAnswers(body);
  const result = repasteBag(c.var.config.db, accountId, bagId, json, {
    ...(answers.roasters[0] === undefined ? {} : { roasterChoice: answers.roasters[0] }),
    ...(answers.coffees[0] === undefined ? {} : { coffeeChoice: answers.coffees[0] }),
  });
  if (result.status === 'not_found') return c.notFound();
  if (result.status === 'saved') {
    if (result.differences.length === 0) return c.redirect(`/bags/${bagId}`, 303);
    return c.html(
      <AppPage title="Pasted" section="library" admin={c.var.admin}>
        <h1>Pasted onto the bag</h1>
        <Differences c={c} accountId={accountId} bagIds={[bagId]} differences={result.differences} />
        <a class="button" href={`/bags/${bagId}`}>
          Back to the bag
        </a>
      </AppPage>,
    );
  }
  const taken = result.status === 'name_taken' ? readCoffee(c.var.config.db, result.coffeeId)?.name : undefined;
  return c.html(
    <RepastePage admin={c.var.admin} detail={detail} json={json} answers={answers} result={result} taken={taken} />,
    result.status === 'invalid' ? 400 : result.status === 'name_taken' ? 409 : 200,
  );
});

editRoutes.post('/bags/:id/verdict', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const bagId = bagIdOf(c);
  const { personal } = formToBag(readForm(await c.req.parseBody())) as { personal: Record<string, unknown> };
  const result = rateBag(c.var.config.db, accountId, bagId, {
    rating: personal.rating,
    rebuy: personal.rebuy,
    note: personal.note,
  });
  if (result.status === 'not_found') return c.notFound();
  if (result.status === 'saved') return c.redirect(`/bags/${bagId}#rating`, 303);
  return c.html(
    <AppPage title="Your rating" section="library" admin={c.var.admin}>
      <h1>Your rating</h1>
      <FormErrors errors={result.errors} />
      <a class="button secondary" href={`/bags/${bagId}#rating`}>
        Back to the bag
      </a>
    </AppPage>,
    400,
  );
});

/** A bag with nothing set, for starting the form from a pool coffee. */
const emptyBag = {
  roaster: { name: '' },
  coffee: {
    name: '',
    country: null,
    region: null,
    farm: null,
    producer: null,
    varieties: [],
    process: { printed: null, category: null },
    altitude: { printed: null, min_m: null, max_m: null },
    tasting_notes: [],
    decaf: false,
  },
  harvest: null,
  lot: null,
  roast: { degree: null, assumed: false, printed: null },
  roast_date: { printed: null, date: null, status: 'missing' },
  weight: { grams: null, assumed: false },
  plan: null,
  brew: { water: null, water_alt: null, kettle_c: null, grinder: null, grind: null },
} satisfies Parameters<typeof bagToForm>[0];

type Detail = NonNullable<ReturnType<typeof bagDetail>>;

function ManualPage(props: {
  admin: boolean;
  values: FormValues;
  answers: Answers;
  result?: Exclude<ImportResult, { status: 'saved' }>;
  from?: ReturnType<typeof startingPoint>;
  fromId?: number;
}) {
  const { result } = props;
  return (
    <AppPage title="Add bag" section="add" admin={props.admin}>
      <div class="page-head">
        <h1>Add bag</h1>
      </div>
      <AddTabs current={props.from === undefined ? 'manual' : 'pool'} />
      <div class="add-grid wide-first">
        <form method="post" action="/add/manual" class="card">
          {result?.status === 'invalid' && <FormErrors errors={result.errors} />}
          {result !== undefined && result.status !== 'invalid' && result.status !== 'preview' && (
            <Outcome result={result} answers={props.answers} />
          )}
          {props.from && <input type="hidden" name="from" value={String(props.fromId)} />}
          {props.from && (
            <div class="callout">
              Starting from <strong>{props.from.coffee.name}</strong> by {props.from.roaster}. Add your own bag below;
              changing a bean fact here shows as a difference from the pool after saving.
            </div>
          )}
          <BagFormFields values={props.values} withRoaster />
          <label class="check">
            <input
              type="checkbox"
              name="personal.private"
              value="yes"
              checked={props.values['personal.private'] === 'yes'}
            />{' '}
            Keep this bean private
          </label>
          <div class="actions">
            <button class="button" type="submit">
              Save bag
            </button>
            <a class="button quiet" href="/">
              Cancel
            </a>
          </div>
        </form>
        <section class="card quiet">
          <h2>Typing it in</h2>
          <p class="muted small">
            Every field follows the same rules as a pasted bag: at most 500 characters of text, at most 20 varieties and
            tasting notes, dates as on the bag.
          </p>
          <p class="muted small">
            Without a plan, the bag gets no reminders. Paste the JSON from your LLM onto the bag later to add one; it
            keeps everything you typed that the JSON leaves out.
          </p>
        </section>
      </div>
    </AppPage>
  );
}

function EditPage(props: {
  c: Context<Env>;
  detail: Detail;
  values: FormValues;
  result?: Exclude<BagEditResult, { status: 'saved' } | { status: 'not_found' }>;
}) {
  const { detail, result } = props;
  const bagId = detail.bagId;
  const taken = result?.status === 'name_taken' ? readCoffee(props.c.var.config.db, result.coffeeId)?.name : undefined;
  return (
    <AppPage title="Edit bag" section="library" admin={props.c.var.admin}>
      <nav class="crumbs small muted" aria-label="Breadcrumb">
        <a href="/">Library</a> / <a href={`/bags/${bagId}`}>{detail.bag.coffee.name}</a> / Edit
      </nav>
      <div class="page-head">
        <h1>Edit bag</h1>
        <span class="muted">
          {detail.bag.roaster.name} · {detail.bag.coffee.name}
        </span>
      </div>
      <form method="post" action={`/bags/${bagId}/edit`} class="card">
        {/* Enter in a field presses the form's first button: make that Save, never the move offered below. */}
        <button type="submit" class="visually-hidden" tabindex={-1}>
          Save changes
        </button>
        {result?.status === 'invalid' && <FormErrors errors={result.errors} />}
        {result?.status === 'name_taken' && (
          <div class="note" role="alert">
            <h2>
              {detail.bag.roaster.name} already has “{taken}”
              {detail.inPool ? ' in the pool' : ' among your private coffees'}
            </h2>
            <p class="muted small">
              Each roaster has one {detail.inPool ? 'pool coffee' : 'private coffee'} per name. If your bag is that
              coffee, move it there; your plan, brew, rating and notes come along, and the bean facts you typed are
              dropped. Otherwise pick another name.
            </p>
            <div class="actions">
              <button class="button" type="submit" name="move_to" value={String(result.coffeeId)}>
                Move my bag to {taken}
              </button>
            </div>
          </div>
        )}
        {detail.inPool && (
          <div class="callout">
            <strong>A change to the bean facts shows for every account</strong>
            <p class="muted small">
              {detail.bag.coffee.name} is a pool coffee, so its facts are shared. Every change is logged, and the admin
              can undo it.
            </p>
          </div>
        )}
        <BagFormFields values={props.values} withRoaster={false} inPool={detail.inPool} />
        <div class="actions">
          <button class="button" type="submit">
            Save changes
          </button>
          <a class="button quiet" href={`/bags/${bagId}`}>
            Cancel
          </a>
        </div>
      </form>
    </AppPage>
  );
}

function RepastePage(props: {
  admin: boolean;
  detail: Detail;
  json: string;
  answers: Answers;
  result?: Exclude<RepasteResult, { status: 'saved' } | { status: 'not_found' }>;
  taken?: string | undefined;
}) {
  const { detail, result } = props;
  return (
    <AppPage title="Paste onto the bag" section="library" admin={props.admin}>
      <nav class="crumbs small muted" aria-label="Breadcrumb">
        <a href="/">Library</a> / <a href={`/bags/${detail.bagId}`}>{detail.bag.coffee.name}</a> / Paste JSON
      </nav>
      <div class="page-head">
        <h1>Paste JSON onto this bag</h1>
      </div>
      <form method="post" action={`/bags/${detail.bagId}/repaste`} class="add-grid">
        <section class="card">
          <label class="field">
            Paste the JSON for this one bag.
            <textarea name="json" class="code" rows={24} spellcheck={false} required>
              {props.json}
            </textarea>
          </label>
          <button class="button" type="submit">
            Paste onto the bag
          </button>
        </section>
        <section class="card">
          {result?.status === 'name_taken' ? (
            <div class="problem" role="alert">
              <h2>You already have a private coffee called “{props.taken}”</h2>
              <p class="small">
                Nothing was saved. Each of your private coffees from a roaster has its own name. To move this bag to
                that coffee, rename it to “{props.taken}” in <a href={`/bags/${detail.bagId}/edit`}>Edit bag</a>; or
                change the name in the JSON.
              </p>
            </div>
          ) : (
            result !== undefined && <Outcome result={result} answers={props.answers} />
          )}
          <h2>What pasting does</h2>
          <ul class="muted small">
            <li>The bag's own fields in the JSON replace the old ones; personal fields it leaves out are kept.</li>
            <li>
              {detail.inPool
                ? 'Bean facts only fill the pool coffee’s gaps. A value that differs is shown with a “Use mine” button.'
                : 'Bean facts change your private coffee in place.'}
            </li>
            <li>A changed “private” makes the bean private or publishes it, as from the bag’s page.</li>
          </ul>
        </section>
      </form>
    </AppPage>
  );
}
