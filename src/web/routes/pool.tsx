import { type Context, Hono } from 'hono';
import { deleteGrinder, editGrinder, listGrinders } from '../../bag/gear.js';
import { browsePool, coffeePage, type PoolFilter } from '../../coffee/search.js';
import { listRoasters, type RoasterFilter, type RoasterRow, roasterFor, setRoasterNote } from '../../roaster/notes.js';
import { RatingBeans } from '../components.js';
import { type Env, requireAccount } from '../context.js';
import { origin, processLabel, shortDate } from '../format.js';
import { AppPage } from '../layout.js';

/** The pool and a coffee's page, the roasters with the account's private notes, and the account's gear. */
export const poolRoutes = new Hono<Env>();

const positive = (value: unknown) => (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : 0);
const queryOf = (c: Context<Env>, name: string) => {
  const value = c.req.query(name);
  return value === undefined || value === '' || value.length > 200 ? undefined : value;
};

poolRoutes.get('/pool', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const filter: PoolFilter = {};
  for (const key of ['query', 'roaster', 'country', 'process', 'variety'] as const) {
    const value = queryOf(c, key === 'query' ? 'q' : key);
    if (value !== undefined) filter[key] = value;
  }
  const { coffees, options } = browsePool(c.var.config.db, accountId, filter);
  const shown = coffees.slice(0, 200);
  const select = (name: keyof PoolFilter, label: string, values: string[], text = (v: string) => v) => (
    <label class="filter">
      <span class="visually-hidden">{label}</span>
      <select name={name}>
        <option value="">{label}</option>
        {values.map((value) => (
          <option value={value} selected={value === filter[name]}>
            {text(value)}
          </option>
        ))}
      </select>
    </label>
  );
  return c.html(
    <AppPage title="Pool" section="pool" admin={c.var.admin}>
      <div class="page-head">
        <h1>Pool</h1>
        <span class="muted">bean facts shared by every account</span>
      </div>
      <form class="filters" method="get" action="/pool">
        <input
          name="q"
          value={filter.query ?? ''}
          placeholder="Coffee, roaster, origin or variety"
          aria-label="Search the pool"
        />
        {select('roaster', 'Roaster', options.roasters)}
        {select('country', 'Country', options.countries)}
        {select('process', 'Process', options.processes, processLabel)}
        {select('variety', 'Variety', options.varieties)}
        <button class="button secondary" type="submit">
          Filter
        </button>
        <a class="button quiet" href="/pool">
          Clear
        </a>
      </form>
      {shown.length === 0 ? (
        <section class="card">
          <p class="muted">No pool coffee matches.</p>
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
                <th>Collective rating</th>
                <th>
                  <span class="visually-hidden">Start</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((coffee) => (
                <tr>
                  <td>
                    <a class="coffee" href={`/pool/${coffee.coffeeId}`}>
                      {coffee.name}
                    </a>
                    <div class="muted small">{coffee.roaster}</div>
                  </td>
                  <td>{origin(coffee.country, coffee.region)}</td>
                  <td>{coffee.process === null ? '' : processLabel(coffee.process)}</td>
                  <td class="muted">{coffee.harvests.join(', ') || 'Not listed'}</td>
                  <td>
                    <Collective rating={coffee.rating} />
                  </td>
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
          Showing {shown.length} of {coffees.length}. Search or filter to narrow the list.
        </p>
      )}
      <p class="muted small">
        The collective rating combines one rating per account, rounded to half a bean, and is rebuilt once a day. It
        stays hidden until 3 accounts have rated a coffee. Private beans never appear here.
      </p>
    </AppPage>,
  );
});

poolRoutes.get('/pool/:id', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const coffee = coffeePage(c.var.config.db, accountId, positive(c.req.param('id')));
  if (coffee === undefined) return c.notFound();
  const { facts } = coffee;
  const latest = coffee.bags[0];
  return c.html(
    <AppPage title={facts.name} section="pool" admin={c.var.admin}>
      <nav class="crumbs small muted" aria-label="Breadcrumb">
        <a href="/pool">Pool</a> / {facts.name}
      </nav>
      <div class="bag-tools">
        <p class="muted">
          <a href={`/roasters/${coffee.roaster.id}`}>{coffee.roaster.name}</a>
        </p>
        <div class="actions">
          {latest !== undefined && (
            <a class="button secondary" href={`/bags/${latest.bagId}/edit`}>
              Edit facts
            </a>
          )}
          <a class="button" href={`/add/manual?from=${coffee.coffeeId}`}>
            Start a bag from this coffee
          </a>
        </div>
      </div>
      <h1 class="display">{facts.name}</h1>
      <div class="chips">
        {origin(facts.country, facts.region) && <span class="chip">{origin(facts.country, facts.region)}</span>}
        {facts.process.category && <span class="chip">{processLabel(facts.process.category)}</span>}
        {facts.varieties.length > 0 && <span class="chip">{facts.varieties.join(', ')}</span>}
        {facts.decaf && <span class="chip">Decaf</span>}
        <span class="pill quiet">{coffee.private ? 'Your private coffee' : 'In the pool'}</span>
      </div>
      <div class="split">
        <section class="card">
          <h2>Bean facts</h2>
          <table class="rows">
            <tbody>
              <Fact label="Producer" value={facts.producer} />
              <Fact label="Farm" value={facts.farm} />
              <Fact
                label="Process"
                value={facts.process.printed ?? (facts.process.category && processLabel(facts.process.category))}
              />
              <Fact label="Altitude" value={facts.altitude.printed} />
              <Fact label="Roaster’s notes" value={facts.tasting_notes.join(', ')} />
            </tbody>
          </table>
          <p class="muted small">
            {coffee.private
              ? 'Only you see this coffee. Edit it from one of your bags.'
              : latest === undefined
                ? 'Anyone with a bag on this coffee can edit its facts; start a bag to edit them. Every edit is logged.'
                : 'Anyone with a bag on this coffee can edit its facts. Every edit is logged.'}
          </p>
        </section>
        <div class="stack">
          {!coffee.private && (
            <section class="card quiet">
              <p class="muted small">Collective rating</p>
              <Collective rating={coffee.rating} large />
              <p class="muted small">One rating per account, across all harvests, rebuilt once a day.</p>
            </section>
          )}
          {!coffee.private && (
            <section class="card">
              <h2>Harvests seen</h2>
              <div class="chips">
                {coffee.harvests.length === 0 ? (
                  <span class="muted">None listed yet</span>
                ) : (
                  coffee.harvests.map((harvest) => <span class="chip">{harvest}</span>)
                )}
              </div>
              <p class="muted small">
                Every harvest is the same pool coffee. A harvest is listed once a published bag has it.
              </p>
            </section>
          )}
          <section class="card">
            <h2>Your bags on it</h2>
            {coffee.bags.length === 0 ? (
              <p class="muted">None yet.</p>
            ) : (
              <table class="rows">
                <tbody>
                  {coffee.bags.map((bag) => (
                    <tr>
                      <th>
                        <a href={`/bags/${bag.bagId}`}>
                          {bag.roastDate === null ? 'No roast date' : `Roasted ${shortDate(bag.roastDate)}`}
                        </a>
                      </th>
                      <td>
                        {processLabel(bag.state)}
                        {bag.harvest ? `, harvest ${bag.harvest}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </AppPage>,
  );
});

poolRoutes.get('/roasters', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const filter: RoasterFilter = {};
  const query = queryOf(c, 'q');
  if (query !== undefined) filter.query = query;
  const only = c.req.query('only');
  if (only === 'bags' || only === 'notes') filter.only = only;
  const { roasters, total } = listRoasters(c.var.config.db, accountId, filter);
  const link = (value: string | undefined, label: string) => {
    const params = new URLSearchParams();
    if (query !== undefined) params.set('q', query);
    if (value !== undefined) params.set('only', value);
    const search = params.toString();
    return (
      <a
        class="tab"
        href={`/roasters${search ? `?${search}` : ''}`}
        aria-current={value === filter.only ? 'page' : undefined}
      >
        {label}
      </a>
    );
  };
  return c.html(
    <AppPage title="Roasters" section="roasters" admin={c.var.admin}>
      <div class="page-head">
        <h1>Roasters</h1>
        <span class="muted">{total === 1 ? '1 roaster' : `${total} roasters`}</span>
      </div>
      <form class="filters" method="get" action="/roasters">
        <input name="q" value={query ?? ''} placeholder="Find a roaster" aria-label="Find a roaster" />
        {filter.only && <input type="hidden" name="only" value={filter.only} />}
        <button class="button secondary" type="submit">
          Search
        </button>
      </form>
      <nav class="tabs" aria-label="Which roasters">
        {link(undefined, 'All')}
        {link('bags', 'With my bags')}
        {link('notes', 'With my notes')}
      </nav>
      <RoasterTable roasters={roasters} />
      {total > roasters.length && (
        <p class="muted small">
          Showing {roasters.length} of {total}. Search to find the others.
        </p>
      )}
      <p class="muted small">Missing a roaster? Roasters come from every.coffee; ask the admin to add one it lacks.</p>
    </AppPage>,
  );
});

poolRoutes.get('/roasters/:id', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const roaster = roasterFor(c.var.config.db, accountId, positive(c.req.param('id')));
  if (roaster === undefined) return c.notFound();
  return c.html(<RoasterPage admin={c.var.admin} roaster={roaster} />);
});

poolRoutes.post('/roasters/:id/note', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const roasterId = positive(c.req.param('id'));
  const body = await c.req.parseBody();
  const note = typeof body.note === 'string' ? body.note : '';
  const result = setRoasterNote(c.var.config.db, accountId, roasterId, note);
  if (result.status === 'not_found') return c.notFound();
  if (result.status === 'too_long') {
    const roaster = roasterFor(c.var.config.db, accountId, roasterId) as RoasterRow;
    return c.html(<RoasterPage admin={c.var.admin} roaster={{ ...roaster, note }} tooLong />, 400);
  }
  return c.redirect(`/roasters/${roasterId}`, 303);
});

poolRoutes.get('/gear', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  return c.html(<GearPage c={c} accountId={accountId} />);
});

poolRoutes.post('/gear/:id', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const grinderId = positive(c.req.param('id'));
  const body = await c.req.parseBody();
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const result = editGrinder(c.var.config.db, accountId, grinderId, { name: text(body.name), note: text(body.note) });
  if (result.status === 'not_found') return c.notFound();
  if (result.status === 'saved') return c.redirect('/gear', 303);
  const message = result.status === 'name_taken' ? 'You already have a grinder with that name.' : result.message;
  return c.html(<GearPage c={c} accountId={accountId} problem={{ grinderId, message }} />, 400);
});

poolRoutes.post('/gear/:id/delete', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const grinderId = positive(c.req.param('id'));
  const result = deleteGrinder(c.var.config.db, accountId, grinderId);
  if (result.status === 'not_found') return c.notFound();
  if (result.status === 'deleted') return c.redirect('/gear', 303);
  const message = `${result.bags === 1 ? 'A bag uses' : `${result.bags} bags use`} this grinder, so it stays.`;
  return c.html(<GearPage c={c} accountId={accountId} problem={{ grinderId, message }} />, 409);
});

function Collective(props: { rating: { value: number; band: string } | null; large?: boolean }) {
  if (props.rating === null) return <span class="muted small">Fewer than 3 ratings</span>;
  return (
    <span>
      {props.large ? <strong class="figure">{props.rating.value}</strong> : <strong>{props.rating.value}</strong>}{' '}
      <RatingBeans rating={props.rating.value} /> <span class="muted small">from {props.rating.band} accounts</span>
    </span>
  );
}

function Fact(props: { label: string; value: string | null | undefined | false }) {
  return (
    <tr>
      <th>{props.label}</th>
      <td class={props.value ? undefined : 'muted'}>{props.value || 'Not stated'}</td>
    </tr>
  );
}

const roasterSource = (roaster: RoasterRow) =>
  roaster.source === 'every_coffee' ? `every.coffee/roaster/${roaster.slug}` : 'added by the admin';

function RoasterTable(props: { roasters: RoasterRow[] }) {
  if (props.roasters.length === 0) {
    return (
      <section class="card">
        <p class="muted">No roaster matches.</p>
      </section>
    );
  }
  return (
    <section class="card table-card">
      <table class="library">
        <thead>
          <tr>
            <th>Roaster</th>
            <th>Your bags</th>
            <th>Your note</th>
          </tr>
        </thead>
        <tbody>
          {props.roasters.map((roaster) => (
            <tr>
              <td>
                <a class="coffee" href={`/roasters/${roaster.id}`}>
                  {roaster.name}
                </a>
                <div class="muted small">{roasterSource(roaster)}</div>
              </td>
              <td>{roaster.bags}</td>
              <td class={roaster.note === null ? 'muted' : undefined}>{roaster.note ?? 'No note'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RoasterPage(props: { admin: boolean; roaster: RoasterRow; tooLong?: boolean }) {
  const { roaster } = props;
  return (
    <AppPage title={roaster.name} section="roasters" admin={props.admin}>
      <nav class="crumbs small muted" aria-label="Breadcrumb">
        <a href="/roasters">Roasters</a> / {roaster.name}
      </nav>
      <h1>{roaster.name}</h1>
      <p class="muted">{roasterSource(roaster)}</p>
      <div class="split">
        <section class="card">
          <h2>Your note</h2>
          <p class="muted small">Your note is private. Other accounts never see it.</p>
          {props.tooLong && (
            <p class="error" role="alert">
              A note can be at most 500 characters.
            </p>
          )}
          <form method="post" action={`/roasters/${roaster.id}/note`}>
            <label class="field">
              <span class="visually-hidden">Note</span>
              <textarea name="note" rows={5} class="note-input">
                {roaster.note ?? ''}
              </textarea>
            </label>
            <button class="button" type="submit">
              Save note
            </button>
          </form>
        </section>
        <section class="card quiet">
          <table class="rows">
            <tbody>
              <tr>
                <th>Your bags</th>
                <td>{roaster.bags}</td>
              </tr>
              {roaster.source === 'every_coffee' && (
                <tr>
                  <th>On every.coffee</th>
                  <td>
                    <a href={`https://every.coffee/roaster/${encodeURIComponent(roaster.slug)}`} rel="noreferrer">
                      Open the roaster page
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p class="muted small">
            <a href={`/pool?roaster=${encodeURIComponent(roaster.name)}`}>Its coffees in the pool</a>
          </p>
        </section>
      </div>
    </AppPage>
  );
}

function GearPage(props: { c: Context<Env>; accountId: number; problem?: { grinderId: number; message: string } }) {
  const grinders = listGrinders(props.c.var.config.db, props.accountId);
  return (
    <AppPage title="Gear" section="gear" admin={props.c.var.admin}>
      <div class="page-head">
        <h1>Gear</h1>
        <span class="muted">your grinders</span>
      </div>
      {grinders.length === 0 ? (
        <section class="card">
          <p class="muted">
            No grinders yet. A grinder is added when a bag names one, by paste or by hand, and is listed here.
          </p>
        </section>
      ) : (
        <div class="stack">
          {grinders.map((grinder) => (
            <section class="card" id={`grinder-${grinder.id}`}>
              {props.problem?.grinderId === grinder.id && (
                <p class="error" role="alert">
                  {props.problem.message}
                </p>
              )}
              <form method="post" action={`/gear/${grinder.id}`} class="form-grid">
                <label class="field">
                  Name
                  <input name="name" value={grinder.name} maxlength={500} required />
                </label>
                <label class="field">
                  Note
                  <input name="note" value={grinder.note ?? ''} maxlength={500} />
                </label>
                <div class="actions">
                  <button class="button secondary" type="submit">
                    Save
                  </button>
                  <span class="muted small">
                    {grinder.bags === 1 ? 'Used by 1 bag' : `Used by ${grinder.bags} bags`}
                  </span>
                </div>
              </form>
              {grinder.bags === 0 && (
                <form method="post" action={`/gear/${grinder.id}/delete`} class="inline">
                  <button class="button quiet" type="submit">
                    Delete
                  </button>
                </form>
              )}
            </section>
          ))}
        </div>
      )}
      <p class="muted small">
        Renaming a grinder renames it on every bag that uses it. Bags find their grinder by name, so a paste naming the
        old name adds it again.
      </p>
    </AppPage>
  );
}
