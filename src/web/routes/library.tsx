import { type Context, Hono } from 'hono';
import { bagDetail, type LibraryBag, type LibraryFilter, library, type Phase } from '../../bag/library.js';
import { type BagState, setBagState } from '../../bag/manage.js';
import { dismissMidPeak, type Reminder, reminders } from '../../bag/reminders.js';
import { Legend, PhasePill, PlanBar, RatingBeans } from '../components.js';
import { type Env, requireAccount, todayFor } from '../context.js';
import {
  addDays,
  dateRange,
  dayLabel,
  dayMonth,
  dayRange,
  longDate,
  origin,
  phaseLabels,
  processLabel,
  shortDate,
  weekdayDate,
} from '../format.js';
import { AppPage } from '../layout.js';

/** The library with its filters, "Coming up" and the toasts; a bag's page; and setting a bag's state. */
export const libraryRoutes = new Hono<Env>();

const phases = Object.keys(phaseLabels) as Phase[];
const states: BagState[] = ['sealed', 'open', 'frozen', 'finished'];

libraryRoutes.get('/', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const today = todayFor(c, accountId);
  const filter = readFilter(c);
  const { bags, total, options } = library(c.var.config.db, accountId, today, filter);
  const { due, comingUp } = reminders(c.var.config.db, accountId, today);
  return c.html(
    <AppPage title="Library" section="library" admin={c.var.admin}>
      <div class="page-head">
        <h1>Library</h1>
        <span class="muted">{total === 1 ? '1 bag' : `${total} bags`}</span>
      </div>
      {due.length > 0 && <Toasts due={due} today={today} />}
      {due.length + comingUp.length > 0 && <ComingUp due={due} comingUp={comingUp} today={today} />}
      <Filters filter={filter} options={options} />
      {bags.length === 0 ? (
        <section class="card">
          <p class="muted">{total === 0 ? 'No bags yet.' : 'No bag matches these filters.'}</p>
        </section>
      ) : (
        <LibraryTable bags={bags} />
      )}
      <Legend />
    </AppPage>,
  );
});

libraryRoutes.get('/bags/:id', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const today = todayFor(c, accountId);
  const detail = bagDetail(c.var.config.db, accountId, bagIdOf(c), today);
  if (detail === undefined) return c.notFound();
  return c.html(
    <AppPage title={detail.bag.coffee.name} section="library" admin={c.var.admin}>
      <BagPage detail={detail} today={today} />
    </AppPage>,
  );
});

libraryRoutes.post('/bags/:id/state', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const body = await c.req.parseBody();
  const state = states.find((s) => s === body.state);
  const bagId = bagIdOf(c);
  if (state === undefined || !setBagState(c.var.config.db, accountId, bagId, state)) return c.notFound();
  return c.redirect(body.from === 'library' ? '/' : `/bags/${bagId}`, 303);
});

libraryRoutes.post('/bags/:id/dismiss-mid-peak', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  if (!dismissMidPeak(c.var.config.db, accountId, bagIdOf(c))) return c.notFound();
  return c.redirect('/', 303);
});

/** The bag id in the path; 0, which no bag has, for anything that is not a plain positive number. */
function bagIdOf(c: Context<Env>): number {
  const id = c.req.param('id') ?? '';
  return /^[1-9]\d{0,15}$/.test(id) ? Number(id) : 0;
}

function readFilter(c: Context<Env>): LibraryFilter {
  const query = (name: string) => {
    const value = c.req.query(name);
    return value === undefined || value === '' || value.length > 200 ? undefined : value;
  };
  const filter: LibraryFilter = {};
  const state = query('state');
  if (state === 'active' || state === 'finished') filter.state = state;
  for (const key of ['roaster', 'process', 'variety'] as const) {
    const value = query(key);
    if (value !== undefined) filter[key] = value;
  }
  const phase = phases.find((p) => p === query('phase'));
  if (phase !== undefined) filter.phase = phase;
  const rating = query('rating');
  if (rating === 'unrated') filter.minRating = 'unrated';
  else if (rating !== undefined && /^[0-5](\.5)?$/.test(rating)) filter.minRating = Number(rating);
  const words = query('q');
  if (words !== undefined) filter.query = words;
  return filter;
}

const eventText = (reminder: Reminder) =>
  reminder.event === 'portion' ? 'Open, portion and freeze' : 'Mid-peak check with a frozen tube';

function Toasts(props: { due: Reminder[]; today: string }) {
  return (
    <div class="toasts" role="status">
      {props.due.map((reminder) => (
        <section class={`toast ${reminder.event}`}>
          <h2>{reminder.event === 'portion' ? 'Open, portion and freeze' : 'Mid-peak check today'}</h2>
          <p class="muted small">
            {reminder.roaster} · {reminder.coffee}
            {reminder.dueOn < props.today ? `, due since ${weekdayDate(reminder.dueOn)}` : ''}.
          </p>
          {reminder.event === 'portion' ? (
            <div class="actions">
              <form method="post" action={`/bags/${reminder.bagId}/state`} class="inline">
                <input type="hidden" name="state" value="frozen" />
                <input type="hidden" name="from" value="library" />
                <button class="button" type="submit">
                  Done: frozen
                </button>
              </form>
              <a class="button quiet" href={`/bags/${reminder.bagId}`}>
                Open the bag
              </a>
            </div>
          ) : (
            <div class="actions">
              <a class="button secondary" href={`/bags/${reminder.bagId}#rating`}>
                Rate it
              </a>
              <form method="post" action={`/bags/${reminder.bagId}/dismiss-mid-peak`} class="inline">
                <button class="button quiet" type="submit">
                  Dismiss
                </button>
              </form>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function ComingUp(props: { due: Reminder[]; comingUp: Reminder[]; today: string }) {
  return (
    <section class="card coming-up">
      <h2>
        Coming up <span class="muted small">Next 10 days, from {longDate(props.today)}</span>
      </h2>
      <table class="events">
        <tbody>
          {[...props.due, ...props.comingUp].map((reminder) => (
            <tr>
              <td class={reminder.dueOn <= props.today ? 'today' : 'muted'}>
                {reminder.dueOn <= props.today ? 'Today' : weekdayDate(reminder.dueOn)}
              </td>
              <td>{eventText(reminder)}</td>
              <td class="muted">
                <a href={`/bags/${reminder.bagId}`}>
                  {reminder.roaster} · {reminder.coffee}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Filters(props: {
  filter: LibraryFilter;
  options: { roasters: string[]; processes: string[]; varieties: string[] };
}) {
  const { filter, options } = props;
  const select = (name: string, label: string, current: string | undefined, values: [string, string][]) => (
    <label class="filter">
      <span class="visually-hidden">{label}</span>
      <select name={name}>
        <option value="">{label}</option>
        {values.map(([value, text]) => (
          <option value={value} selected={value === current}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const rating = filter.minRating === undefined ? undefined : String(filter.minRating);
  return (
    <form class="filters" method="get" action="/">
      {select('state', 'All bags', filter.state, [
        ['active', 'Not finished'],
        ['finished', 'Finished'],
      ])}
      {select(
        'roaster',
        'Roaster',
        filter.roaster,
        options.roasters.map((r) => [r, r]),
      )}
      {select(
        'process',
        'Process',
        filter.process,
        options.processes.map((p) => [p, processLabel(p)]),
      )}
      {select(
        'variety',
        'Variety',
        filter.variety,
        options.varieties.map((v) => [v, v]),
      )}
      {select(
        'phase',
        'Phase',
        filter.phase,
        phases.map((p) => [p, phaseLabels[p]]),
      )}
      {select('rating', 'Rating', rating, [
        ['4.5', '4.5 and up'],
        ['4', '4 and up'],
        ['3', '3 and up'],
        ['unrated', 'Not rated'],
      ])}
      <input name="q" value={filter.query ?? ''} placeholder="Search coffee, roaster or origin" aria-label="Search" />
      <button class="button secondary" type="submit">
        Filter
      </button>
      <a class="button quiet" href="/">
        Clear
      </a>
    </form>
  );
}

function LibraryTable(props: { bags: LibraryBag[] }) {
  return (
    <section class="card table-card">
      <table class="library">
        <thead>
          <tr>
            <th>Coffee</th>
            <th>Origin</th>
            <th>Process</th>
            <th>Roasted</th>
            <th>Plan, day 0 to 60</th>
            <th>Phase</th>
            <th>Rating</th>
            <th>
              <span class="visually-hidden">Pool or private</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.bags.map((bag) => (
            <tr class={bag.state === 'finished' ? 'finished' : undefined}>
              <td>
                <a class="coffee" href={`/bags/${bag.bagId}`}>
                  {bag.coffee}
                </a>
                <div class="muted small">
                  {bag.roaster}
                  {bag.state === 'finished' ? ' · finished' : ''}
                </div>
              </td>
              <td>{origin(bag.country, bag.region)}</td>
              <td>{bag.process === null ? '' : processLabel(bag.process)}</td>
              <td>
                {bag.roastDate !== null ? (
                  <>
                    {shortDate(bag.roastDate)}
                    <div class="muted small">{bag.day === null ? '' : `day ${dayLabel(bag.day)}`}</div>
                  </>
                ) : (
                  <>
                    {bag.roastDatePrinted ?? ''}
                    <div class="muted small">{bag.roastDateStatus === 'ambiguous' ? 'ambiguous date' : 'no date'}</div>
                  </>
                )}
              </td>
              <td>
                <PlanBar plan={bag.plan} day={bag.day} faded={bag.state === 'finished' || bag.roastDate === null} />
              </td>
              <td>
                <PhasePill phase={bag.phase} />
              </td>
              <td>
                <RatingBeans rating={bag.rating} />
              </td>
              <td class="muted small">{bag.private ? 'Private' : 'Pool'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function BagPage(props: { detail: NonNullable<ReturnType<typeof bagDetail>>; today: string }) {
  const { bag, phase, day } = props.detail;
  const roastDate = bag.roast_date.date;
  const plan = bag.plan;
  const state = bag.personal?.state ?? 'sealed';
  const water = bag.brew.water;
  const facts = bag.coffee;
  return (
    <>
      <nav class="crumbs small muted" aria-label="Breadcrumb">
        <a href="/">Library</a> / {facts.name}
      </nav>
      <p class="muted">{bag.roaster.name}</p>
      <div class="bag-head">
        <div>
          <h1 class="display">{facts.name}</h1>
          <div class="chips">
            {origin(facts.country, facts.region) && <span class="chip">{origin(facts.country, facts.region)}</span>}
            {facts.process.category && <span class="chip">{processLabel(facts.process.category)}</span>}
            {bag.roast.degree && (
              <span class={bag.roast.assumed ? 'chip assumed' : 'chip'}>
                {processLabel(bag.roast.degree)}
                {bag.roast.assumed ? ', assumed' : ''}
              </span>
            )}
            {bag.weight.grams !== null && (
              <span class={bag.weight.assumed ? 'chip assumed' : 'chip'}>{bag.weight.grams} g</span>
            )}
          </div>
        </div>
        <form method="post" action={`/bags/${props.detail.bagId}/state`} class="state-form">
          <label class="filter">
            <span class="visually-hidden">State</span>
            <select name="state">
              {states.map((s) => (
                <option value={s} selected={s === state}>
                  {processLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <button class="button secondary" type="submit">
            Set state
          </button>
        </form>
      </div>

      <section class="card">
        <p>
          <PhasePill phase={phase} /> <strong>{phaseSentence(phase, day, roastDate, plan)}</strong>
        </p>
        {roastDate !== null && plan !== null && (
          <>
            <PlanBar plan={plan} day={day} large />
            <div class="plan-columns">
              <div>
                <span class="muted small">Roasted</span>
                <strong>{shortDate(roastDate)}</strong>
                <span class="muted small">day 0</span>
              </div>
              <div>
                <span class="muted small">Rest</span>
                <strong class="ink-rested">{dateRange(roastDate, plan.rest.from, plan.rest.to)}</strong>
                <span class="muted small">{dayRange(plan.rest)}</span>
              </div>
              <div>
                <span class="muted small">Open, portion and freeze</span>
                <strong class="ink-portion">{dateRange(roastDate, plan.portion.from, plan.portion.to)}</strong>
                <span class="muted small">{dayRange(plan.portion)}</span>
              </div>
              <div>
                <span class="muted small">Peak</span>
                <strong class="ink-peak">{dateRange(roastDate, plan.peak.from, plan.peak.to)}</strong>
                <span class="muted small">{dayRange(plan.peak)}</span>
              </div>
              <div>
                <span class="muted small">Mid-peak check</span>
                <strong>{shortDate(addDays(roastDate, plan.mid_peak))}</strong>
                <span class="muted small">{dayLabel(plan.mid_peak)}, from a frozen tube</span>
              </div>
            </div>
            {plan.tubes > 0 && (
              <p class="small">
                {bag.weight.grams !== null ? `${bag.weight.grams} g makes ` : ''}
                {plan.tubes} tubes, plus {plan.dial_in_g} g for the fresh dial-in.
              </p>
            )}
          </>
        )}
      </section>

      <div class="three">
        <section class="card">
          <h2>Brew</h2>
          {water === null ? (
            <p class="muted">No water logged.</p>
          ) : (
            <>
              <p class="muted small">Water, ppm as CaCO3</p>
              <p class="figures">
                GH <strong>{water.gh}</strong> KH <strong>{water.kh}</strong>
              </p>
            </>
          )}
          <table class="rows">
            <tbody>
              {water !== null && (
                <tr>
                  <th>Minerals</th>
                  <td>{minerals(water)}</td>
                </tr>
              )}
              {bag.brew.water_alt && (
                <tr>
                  <th>Alternative</th>
                  <td>
                    GH {bag.brew.water_alt.gh}, KH {bag.brew.water_alt.kh}
                    {minerals(bag.brew.water_alt) && ` (${minerals(bag.brew.water_alt)})`}
                  </td>
                </tr>
              )}
              <tr>
                <th>Kettle</th>
                <td>{bag.brew.kettle_c === null ? 'Not set' : `${bag.brew.kettle_c} °C`}</td>
              </tr>
              <tr>
                <th>Grinder</th>
                <td>{bag.brew.grinder ?? 'Not set'}</td>
              </tr>
              <tr>
                <th>Grind</th>
                <td>{bag.brew.grind ?? 'Not set'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h2>
            Bean <span class="pill quiet">{props.detail.inPool ? 'In the pool' : 'Private'}</span>
          </h2>
          <table class="rows">
            <tbody>
              <tr>
                <th>Producer</th>
                <td>{[facts.producer, facts.farm].filter(Boolean).join(', ') || 'Not stated'}</td>
              </tr>
              <tr>
                <th>Varieties</th>
                <td>{facts.varieties.join(', ') || 'Not stated'}</td>
              </tr>
              <tr>
                <th>Process</th>
                <td>
                  {facts.process.printed ??
                    (facts.process.category ? processLabel(facts.process.category) : 'Not stated')}
                </td>
              </tr>
              <tr>
                <th>Altitude</th>
                <td>{facts.altitude.printed ?? 'Not stated'}</td>
              </tr>
              <tr>
                <th>Harvest</th>
                <td>{bag.harvest ?? 'Not stated'}</td>
              </tr>
              <tr>
                <th>Roaster's notes</th>
                <td>{facts.tasting_notes.join(', ') || 'None'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="stack">
          <section class="card" id="rating">
            <h2>Your rating</h2>
            <RatingBeans rating={bag.personal?.rating ?? null} />
            <p class="muted small">
              Only you see this rating; it joins the collective rating without your account
              {props.detail.inPool ? '.' : ' once the bean is in the pool.'}
            </p>
            {bag.personal?.note && <p class="note-text">{bag.personal.note}</p>}
          </section>
          <section class="card quiet">
            <p class="muted small">{props.detail.inPool ? 'In the pool' : 'Private'}</p>
            {props.detail.collective !== null ? (
              <p>
                <strong>{props.detail.collective.rating}</strong>{' '}
                <RatingBeans rating={props.detail.collective.rating} />{' '}
                <span class="muted small">from {props.detail.collective.band} accounts</span>
              </p>
            ) : (
              props.detail.inPool && <p class="muted small">No collective rating yet: it shows from 3 accounts.</p>
            )}
            <p class="muted small">
              {props.detail.inPool
                ? 'Other accounts see the bean facts and the collective rating, never your plan, water, grind or notes.'
                : 'No other account sees this bean.'}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function minerals(water: Partial<Record<'ca' | 'mg' | 'na' | 'k', number | null | undefined>>): string {
  return (
    [
      ['Ca', water.ca],
      ['Mg', water.mg],
      ['Na', water.na],
      ['K', water.k],
    ] as const
  )
    .filter(([, value]) => value != null)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');
}

function phaseSentence(
  phase: Phase,
  day: number | null,
  roastDate: string | null,
  plan: NonNullable<ReturnType<typeof bagDetail>>['bag']['plan'],
): string {
  if (roastDate === null || day === null) return 'No roast date, so no plan dates.';
  const today = `Day ${dayLabel(day)}.`;
  if (plan === null) return `${today} No plan.`;
  const opens = dayMonth(addDays(roastDate, plan.portion.from));
  const closes = dayMonth(addDays(roastDate, plan.portion.to));
  const portion = opens === closes ? `on ${opens}` : `between ${opens} and ${closes}`;
  switch (phase) {
    case 'resting':
      return `${today} Keep sealed. Open, portion and freeze ${portion}.`;
    case 'rested':
      return `${today} Rested. Open, portion and freeze ${portion}; the peak starts ${dayMonth(addDays(roastDate, plan.peak.from))}.`;
    case 'peak':
      return `${today} In peak until ${dayMonth(addDays(roastDate, plan.peak.to))}.`;
    default:
      return `${today} Past peak since ${dayMonth(addDays(roastDate, plan.peak.to + 1))}.`;
  }
}
