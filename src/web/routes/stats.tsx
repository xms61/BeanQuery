import { Hono } from 'hono';
import { type AccountStats, accountStats, type Tally } from '../../stats/stats.js';
import { worldMap } from '../../stats/world-map.data.js';
import { type Env, requireAccount } from '../context.js';
import { money, monthLabel, processLabel } from '../format.js';
import { AppPage } from '../layout.js';

/** The statistics page: the account's own bags by origin, bean and spending. */
export const statsRoutes = new Hono<Env>();

statsRoutes.get('/stats', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const stats = accountStats(c.var.config.db, accountId);
  return c.html(
    <AppPage title="Stats" section="stats" admin={c.var.admin}>
      <div class="page-head">
        <h1>Stats</h1>
        <span class="muted">
          {stats.bags === 1 ? '1 bag' : `${stats.bags} bags`}, private ones included; only you see this
        </span>
      </div>
      {stats.bags === 0 ? (
        <section class="card">
          <p class="muted">No bags yet. Your stats fill in as you add bags.</p>
        </section>
      ) : (
        <StatsPage stats={stats} />
      )}
    </AppPage>,
  );
});

function StatsPage(props: { stats: AccountStats }) {
  const { stats } = props;
  return (
    <>
      <section class="card stats-section">
        <h2>Origins</h2>
        <WorldMap stats={stats} />
        {stats.unmatched.length > 0 && (
          <p class="muted small">Not on the map, as written on your bags: {stats.unmatched.join(', ')}.</p>
        )}
        <div class="stats-grid">
          <TallyTable title="Countries" tallies={stats.countries} />
          <TallyTable
            title="Regions"
            tallies={stats.regions.map((r) => ({ ...r, label: `${r.label} · ${r.country}` }))}
          />
        </div>
      </section>
      <section class="card stats-section">
        <h2>Beans</h2>
        <div class="stats-grid">
          <TallyTable
            title="Altitude"
            tallies={stats.altitudes}
            note={stats.noAltitude > 0 ? `${stats.noAltitude} without an altitude` : undefined}
          />
          <TallyTable title="Varieties" tallies={stats.varieties} />
          <TallyTable
            title="Processes"
            tallies={stats.processes.map((p) => ({ ...p, label: processLabel(p.label) }))}
          />
          <TallyTable title="Roast" tallies={stats.roasts.map((r) => ({ ...r, label: processLabel(r.label) }))} />
        </div>
      </section>
      <section class="card stats-section">
        <h2>Roasters and spending</h2>
        <div class="stats-grid">
          <TallyTable title="Roasters" tallies={stats.roasters} />
          <Spending stats={stats} />
        </div>
      </section>
    </>
  );
}

/** The world map, each country shaded by its share of the bags, with its numbers in a tooltip on hover. */
function WorldMap(props: { stats: AccountStats }) {
  const byId = new Map(props.stats.countries.flatMap((c) => (c.mapId === null ? [] : [[c.mapId, c]])));
  const most = Math.max(1, ...[...byId.values()].map((c) => c.bags));
  return (
    <svg
      class="world-map"
      viewBox={`0 0 ${worldMap.width} ${worldMap.height}`}
      role="img"
      aria-label="World map of the countries your bags come from"
    >
      {worldMap.countries.map((country) => {
        const tally = byId.get(country.id);
        if (tally === undefined) {
          return (
            <path d={country.d}>
              <title>{country.name}</title>
            </path>
          );
        }
        return (
          <path d={country.d} class={`tried m${Math.ceil((tally.bags / most) * 4)}`}>
            <title>{`${country.name}: ${bagsLabel(tally.bags)}${ratingLabel(tally)}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

function TallyTable(props: { title: string; tallies: Tally[]; note?: string | undefined }) {
  return (
    <div>
      <h3>{props.title}</h3>
      {props.tallies.length === 0 ? (
        <p class="muted small">None recorded yet.</p>
      ) : (
        <table class="stats">
          <thead>
            <tr>
              <th>
                <span class="visually-hidden">{props.title}</span>
              </th>
              <th class="number">Bags</th>
              <th class="number">Rating</th>
            </tr>
          </thead>
          <tbody>
            {props.tallies.map((tally) => (
              <tr>
                <td>{tally.label}</td>
                <td class="number">{tally.bags}</td>
                <td class={tally.rating === null ? 'number muted' : 'number'}>
                  {tally.rating === null ? 'Not rated' : tally.rating.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.note && <p class="muted small">{props.note}</p>}
    </div>
  );
}

function Spending(props: { stats: AccountStats }) {
  const { spending, pricedUndated } = props.stats;
  return (
    <div>
      <h3>Spending by month</h3>
      {spending.length === 0 ? (
        <p class="muted small">Add a price and the date bought to a bag to see what you spend.</p>
      ) : (
        <table class="stats">
          <thead>
            <tr>
              <th>Month</th>
              <th class="number">Bags</th>
              <th class="number">Spent</th>
              <th class="number">Per 100 g</th>
            </tr>
          </thead>
          <tbody>
            {spending.map((month) => (
              <tr>
                <td>{monthLabel(month.month)}</td>
                <td class="number">{month.bags}</td>
                <td class="number">{money(month.cents, month.currency)}</td>
                <td class={month.per100g === null ? 'number muted' : 'number'}>
                  {month.per100g === null ? 'No weight' : money(month.per100g, month.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pricedUndated > 0 && (
        <p class="muted small">
          {bagsLabel(pricedUndated)} with a price but no date bought {pricedUndated === 1 ? 'is' : 'are'} left out.
        </p>
      )}
    </div>
  );
}

const bagsLabel = (bags: number) => (bags === 1 ? '1 bag' : `${bags} bags`);
const ratingLabel = (tally: Tally) => (tally.rating === null ? '' : `, rated ${tally.rating.toFixed(1)} on average`);
