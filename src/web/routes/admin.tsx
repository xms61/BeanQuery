import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Child } from 'hono/jsx';
import {
  addRoasterAlias,
  adminAddRoaster,
  adminCoffee,
  adminCreateInvite,
  adminDeleteAccount,
  adminEditCoffee,
  adminImportRoasters,
  adminOpenInviteCount,
  adminPoolCoffees,
  deletePoolCoffee,
  editLog,
  listAccounts,
  mergeCoffees,
  undoEdit,
} from '../../admin/admin.js';
import type { ContractError } from '../../contract/bag-json.js';
import { findRoasters, type Roaster } from '../../roaster/registry.js';
import { CoffeeFormFields, coffeeToForm, FormErrors, type FormValues, formToBag, readForm } from '../bag-form.js';
import { type Env, requireAccount } from '../context.js';
import { longDate } from '../format.js';
import { AppPage } from '../layout.js';
import { fieldLabels } from './add.js';

/**
 * The admin screens: invites and accounts, roasters and spellings with the saved-page upload, and pool coffees with
 * their edit log. Every path under /admin answers "not found" to anyone but an admin, and every domain function
 * checks again.
 */
export const adminRoutes = new Hono<Env>();

adminRoutes.use('/admin', adminOnly);
adminRoutes.use('/admin/*', adminOnly);

async function adminOnly(c: Context<Env>, next: () => Promise<void>) {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  if (!c.var.admin) return c.notFound();
  await next();
}

/** The signed-in admin's account id; the middleware has made sure there is one. */
const adminOf = (c: Context<Env>) => c.var.accountId as number;
const positive = (value: unknown) => (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : 0);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

adminRoutes.get('/admin', (c) => c.html(<InvitesPage c={c} />));

adminRoutes.post('/admin/invites', (c) => {
  const result = adminCreateInvite(c.var.config.db, adminOf(c), c.var.config.now());
  if (result.status !== 'saved') return c.notFound();
  return c.html(<InvitesPage c={c} invite={result} />);
});

adminRoutes.post('/admin/accounts/:id/delete', async (c) => {
  const body = await c.req.parseBody();
  if (body.confirm !== 'yes') return c.html(<InvitesPage c={c} problem="Tick the box to confirm." />, 400);
  const result = adminDeleteAccount(c.var.config.db, adminOf(c), positive(c.req.param('id')));
  if (result.status === 'own_account') {
    return c.html(<InvitesPage c={c} problem="Delete your own account from the account page." />, 400);
  }
  if (result.status !== 'deleted') return c.notFound();
  return c.redirect('/admin', 303);
});

adminRoutes.get('/admin/roasters', (c) => c.html(<RoastersPage c={c} />));

adminRoutes.post('/admin/roasters', async (c) => {
  const name = text((await c.req.parseBody()).name).trim();
  const result = adminAddRoaster(c.var.config.db, adminOf(c), name);
  if (result.status === 'invalid') {
    return c.html(<RoastersPage c={c} message={{ problem: 'A roaster name needs a letter or a digit.' }} />, 400);
  }
  if (result.status !== 'saved') return c.notFound();
  return c.html(<RoastersPage c={c} message={{ done: `${result.roaster.name} is registered.` }} />);
});

adminRoutes.post('/admin/roasters/spelling', async (c) => {
  const body = await c.req.parseBody();
  const spelling = text(body.spelling).trim();
  const roasterName = text(body.roaster).trim();
  let roasterId = positive(body.roaster_id);
  if (roasterId === 0) {
    const matches = findRoasters(c.var.config.db, roasterName);
    if (matches.length !== 1) {
      return c.html(<RoastersPage c={c} spelling={{ roasterName, spelling, matches }} />, matches.length ? 200 : 400);
    }
    roasterId = (matches[0] as Roaster).id;
  }
  const result = addRoasterAlias(c.var.config.db, adminOf(c), roasterId, spelling);
  if (result.status === 'not_admin') return c.notFound();
  if (result.status !== 'saved') {
    const problem = result.status === 'invalid' ? 'A spelling needs a letter or a digit.' : 'No such roaster.';
    return c.html(<RoastersPage c={c} message={{ problem }} />, 400);
  }
  return c.html(<RoastersPage c={c} message={{ done: `“${spelling}” now resolves without asking.` }} />);
});

// A saved copy of every.coffee/roasters runs to a few megabytes, more than the app's 1 MB for other forms.
adminRoutes.post(
  '/admin/roasters/upload',
  bodyLimit({ maxSize: 21 * 1024 * 1024, onError: (c) => c.text('That file is over 20 MB.', 413) }),
  async (c) => {
    const body = await c.req.parseBody();
    const html = body.file instanceof File ? await body.file.text() : '';
    const result = adminImportRoasters(c.var.config.db, adminOf(c), html);
    if (result.status === 'not_admin') return c.notFound();
    if (result.status === 'invalid') return c.html(<RoastersPage c={c} message={{ problem: result.message }} />, 400);
    const { added, renamed, unchanged, notListed } = result.summary;
    const done = `Imported: ${added} new, ${renamed} renamed, ${unchanged} unchanged, ${notListed} no longer listed (kept).`;
    return c.html(<RoastersPage c={c} message={{ done }} />);
  },
);

adminRoutes.get('/admin/coffees', (c) => {
  const query = (c.req.query('q') ?? '').slice(0, 200);
  const result = adminPoolCoffees(c.var.config.db, adminOf(c), query);
  if (!('coffees' in result)) return c.notFound();
  return c.html(
    <AdminPage c={c} tab="coffees">
      <form class="filters" method="get" action="/admin/coffees">
        <input name="q" value={query} placeholder="Find a pool coffee" aria-label="Find a pool coffee" />
        <button class="button secondary" type="submit">
          Search
        </button>
      </form>
      {result.coffees.length === 0 ? (
        <section class="card">
          <p class="muted">No pool coffee matches.</p>
        </section>
      ) : (
        <section class="card table-card">
          <table class="library">
            <thead>
              <tr>
                <th>Coffee</th>
                <th>Bags</th>
                <th>Edits</th>
                <th>Last edit</th>
              </tr>
            </thead>
            <tbody>
              {result.coffees.map((coffee) => (
                <tr>
                  <td>
                    <a class="coffee" href={`/admin/coffees/${coffee.coffeeId}`}>
                      {coffee.name}
                    </a>
                    <div class="muted small">{coffee.roaster}</div>
                  </td>
                  <td>{coffee.bags}</td>
                  <td>{coffee.edits}</td>
                  <td class={coffee.lastEdit === null ? 'muted' : undefined}>
                    {coffee.lastEdit === null ? 'Never' : longDate(coffee.lastEdit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {result.total > result.coffees.length && (
        <p class="muted small">
          Showing {result.coffees.length} of {result.total}. Search to narrow the list.
        </p>
      )}
    </AdminPage>,
  );
});

adminRoutes.get('/admin/coffees/:id', (c) => {
  const page = coffeePage(c, positive(c.req.param('id')));
  return page ?? c.notFound();
});

adminRoutes.post('/admin/coffees/:id', async (c) => {
  const coffeeId = positive(c.req.param('id'));
  const values = readForm(await c.req.parseBody());
  const result = adminEditCoffee(c.var.config.db, adminOf(c), coffeeId, formToBag(values).coffee);
  if (result.status === 'not_admin' || result.status === 'not_found') return c.notFound();
  if (result.status === 'saved') return c.redirect(`/admin/coffees/${coffeeId}`, 303);
  const problem =
    result.status === 'invalid'
      ? { errors: result.errors.map((e) => ({ ...e, path: e.path === '' ? 'coffee' : `coffee.${e.path}` })) }
      : { message: 'Another pool coffee of this roaster has that name. Merge the two instead.' };
  return coffeePage(c, coffeeId, { values, ...problem }, result.status === 'invalid' ? 400 : 409) ?? c.notFound();
});

adminRoutes.post('/admin/edits/:id/undo', async (c) => {
  const coffeeId = positive(text((await c.req.parseBody()).coffee));
  const result = undoEdit(c.var.config.db, adminOf(c), positive(c.req.param('id')));
  if (result.status === 'not_admin' || result.status === 'not_found') return c.notFound();
  if (result.status === 'saved') return c.redirect(coffeeId > 0 ? `/admin/coffees/${coffeeId}` : '/admin/coffees', 303);
  const message =
    result.status === 'name_taken'
      ? 'Another pool coffee of this roaster has taken the old name since, so this rename stays.'
      : 'The old value no longer fits the facts edited since, so this edit stays.';
  return coffeePage(c, coffeeId, { message }, 409) ?? c.notFound();
});

adminRoutes.post('/admin/coffees/:id/merge', async (c) => {
  const dropId = positive(c.req.param('id'));
  const keepId = positive(text((await c.req.parseBody()).into));
  const result = mergeCoffees(c.var.config.db, adminOf(c), keepId, dropId);
  if (result.status === 'not_admin') return c.notFound();
  if (result.status === 'merged') return c.redirect(`/admin/coffees/${keepId}`, 303);
  const message =
    result.status === 'different_roasters'
      ? 'Only coffees of the same roaster can be merged.'
      : 'Pick a coffee to keep.';
  return coffeePage(c, dropId, { message }, 400) ?? c.notFound();
});

adminRoutes.post('/admin/coffees/:id/delete', async (c) => {
  const coffeeId = positive(c.req.param('id'));
  if ((await c.req.parseBody()).confirm !== 'yes') {
    return coffeePage(c, coffeeId, { message: 'Tick the box to confirm.' }, 400) ?? c.notFound();
  }
  const result = deletePoolCoffee(c.var.config.db, adminOf(c), coffeeId);
  if (result.status !== 'deleted') return c.notFound();
  return c.redirect('/admin/coffees', 303);
});

function AdminPage(props: { c: Context<Env>; tab: 'accounts' | 'roasters' | 'coffees'; children: Child }) {
  const tabs = [
    ['accounts', '/admin', 'Invites and accounts'],
    ['roasters', '/admin/roasters', 'Roasters'],
    ['coffees', '/admin/coffees', 'Pool coffees'],
  ] as const;
  return (
    <AppPage title="Admin" section="admin" admin>
      <div class="page-head">
        <h1>Admin</h1>
        <span class="muted">only you see this</span>
      </div>
      <nav class="tabs" aria-label="Admin">
        {tabs.map(([key, href, label]) => (
          <a class="tab" href={href} aria-current={key === props.tab ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {props.children}
    </AppPage>
  );
}

function InvitesPage(props: { c: Context<Env>; invite?: { code: string; expiresOn: string }; problem?: string }) {
  const { c } = props;
  const adminId = adminOf(c);
  const open = adminOpenInviteCount(c.var.config.db, adminId, c.var.config.now());
  const accounts = listAccounts(c.var.config.db, adminId);
  if (typeof open !== 'number' || !Array.isArray(accounts)) return <p>Not found</p>;
  return (
    <AdminPage c={c} tab="accounts">
      <div class="split">
        <div class="stack">
          <section class="card">
            <h2>Invites</h2>
            <p>
              <strong class="figure">{open}</strong>
              <span class="muted small">{open === 1 ? 'open invite' : 'open invites'}, valid 14 days each</span>
            </p>
            {props.invite && (
              <div class="note" role="status">
                <p class="secret">{props.invite.code}</p>
                <p class="muted small">
                  Shown once; valid until {longDate(props.invite.expiresOn)}. Send it however you like. Redeeming
                  deletes it, and nothing links it to the account it creates.
                </p>
              </div>
            )}
            <form method="post" action="/admin/invites">
              <button class="button" type="submit">
                Create invite
              </button>
            </form>
          </section>
        </div>
        <section class="card">
          <h2>Accounts</h2>
          {props.problem && (
            <p class="error" role="alert">
              {props.problem}
            </p>
          )}
          <table class="rows">
            <tbody>
              {accounts.map((account) => (
                <tr>
                  <th>
                    <code>{account.fingerprint}</code>
                    {account.admin && <span class="muted small"> admin</span>}
                  </th>
                  <td>
                    <span class="muted small">last seen</span> {longDate(account.lastSeenOn)}
                  </td>
                  <td>
                    {account.accountId !== adminId && (
                      <form method="post" action={`/admin/accounts/${account.accountId}/delete`} class="inline-confirm">
                        <label class="check small">
                          <input type="checkbox" name="confirm" value="yes" required /> Sure
                        </label>
                        <button class="button quiet" type="submit">
                          Delete account
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="muted small">
            Accounts carry dates only, never times. Deleting one removes its bags, private coffees, grinders, notes and
            sessions; its pool edits stay, without the account. A new admin comes from the server command, never from
            here.
          </p>
        </section>
      </div>
    </AdminPage>
  );
}

function RoastersPage(props: {
  c: Context<Env>;
  message?: { done: string } | { problem: string };
  spelling?: { roasterName: string; spelling: string; matches: Roaster[] };
}) {
  const { message, spelling } = props;
  return (
    <AdminPage c={props.c} tab="roasters">
      {message && 'done' in message && (
        <p class="ok" role="status">
          {message.done}
        </p>
      )}
      {message && 'problem' in message && (
        <p class="error" role="alert">
          {message.problem}
        </p>
      )}
      <div class="split">
        <section class="card">
          <h2>Upload a saved copy of every.coffee</h2>
          <p class="muted small">
            The weekly fetch stops when every.coffee refuses it, and never retries in disguise. Save
            every.coffee/roasters from a browser and upload the file here. New roasters are added, renamed ones keep
            their id, and none is ever deleted.
          </p>
          <form method="post" action="/admin/roasters/upload" enctype="multipart/form-data">
            <label class="field">
              Saved page
              <input type="file" name="file" accept=".html,.htm,text/html" required />
            </label>
            <button class="button secondary" type="submit">
              Upload and import
            </button>
          </form>
        </section>
        <div class="stack">
          <section class="card">
            <h2>Add a roaster</h2>
            <p class="muted small">For a roaster every.coffee lacks. It resolves on the next paste.</p>
            <form method="post" action="/admin/roasters">
              <label class="field">
                Name
                <input name="name" maxlength={500} required />
              </label>
              <button class="button" type="submit">
                Add roaster
              </button>
            </form>
          </section>
          <section class="card">
            <h2>Add a spelling</h2>
            <p class="muted small">Another way a bag spells a registered roaster, so it matches without asking.</p>
            <form method="post" action="/admin/roasters/spelling">
              <label class="field">
                Roaster
                <input name="roaster" value={spelling?.roasterName ?? ''} maxlength={500} required />
              </label>
              {spelling && spelling.matches.length === 0 && (
                <p class="error small">No registered roaster has that name.</p>
              )}
              {spelling && spelling.matches.length > 1 && (
                <fieldset class="question">
                  <legend>Several roasters have that name</legend>
                  {spelling.matches.map((roaster) => (
                    <label class="choice">
                      <input type="radio" name="roaster_id" value={String(roaster.id)} required />
                      <span>
                        <strong>{roaster.name}</strong>
                        <span class="muted small"> {roaster.slug}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <label class="field">
                Spelling
                <input name="spelling" value={spelling?.spelling ?? ''} maxlength={500} required />
              </label>
              <button class="button secondary" type="submit">
                Add spelling
              </button>
            </form>
          </section>
        </div>
      </div>
    </AdminPage>
  );
}

/** A pool coffee's admin page: its facts form, merge and delete, and the edit log with undo. Undefined when missing. */
function coffeePage(
  c: Context<Env>,
  coffeeId: number,
  state: { values?: FormValues; errors?: ContractError[]; message?: string } = {},
  status: 200 | 400 | 409 = 200,
) {
  const db = c.var.config.db;
  const coffee = adminCoffee(db, adminOf(c), coffeeId);
  const log = editLog(db, adminOf(c), coffeeId);
  if (coffee.status !== 'found' || !Array.isArray(log)) return undefined;
  const shown = (value: string | null) => {
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
  };
  return c.html(
    <AdminPage c={c} tab="coffees">
      <nav class="crumbs small muted" aria-label="Breadcrumb">
        <a href="/admin/coffees">Pool coffees</a> / {coffee.facts.name}
      </nav>
      <div class="page-head">
        <h2>{coffee.facts.name}</h2>
        <span class="muted">
          {coffee.roaster} · {coffee.bags === 1 ? '1 bag' : `${coffee.bags} bags`} ·{' '}
          <a href={`/pool/${coffee.coffeeId}`}>pool page</a>
        </span>
      </div>
      {state.message && (
        <p class="error" role="alert">
          {state.message}
        </p>
      )}
      <div class="split">
        <form method="post" action={`/admin/coffees/${coffee.coffeeId}`} class="card">
          {state.errors && <FormErrors errors={state.errors} />}
          <CoffeeFormFields values={state.values ?? coffeeToForm(coffee.facts)} />
          <p class="muted small">Your edit is logged like anyone's, so it can be undone.</p>
          <button class="button" type="submit">
            Save facts
          </button>
        </form>
        <div class="stack">
          <section class="card">
            <h2>Merge into another coffee</h2>
            {coffee.others.length === 0 ? (
              <p class="muted small">{coffee.roaster} has no other pool coffee.</p>
            ) : (
              <form method="post" action={`/admin/coffees/${coffee.coffeeId}/merge`}>
                <label class="field">
                  Keep
                  <select name="into" required>
                    {coffee.others.map((other) => (
                      <option value={String(other.coffeeId)}>{other.name}</option>
                    ))}
                  </select>
                </label>
                <button class="button secondary" type="submit">
                  Merge into it
                </button>
              </form>
            )}
            <p class="muted small">
              Bags and harvests move to the coffee kept, and this one goes, with its edit log. The kept coffee's facts
              stay as they are.
            </p>
          </section>
          <section class="card">
            <h2>Delete this coffee</h2>
            <form method="post" action={`/admin/coffees/${coffee.coffeeId}/delete`}>
              <label class="check">
                <input type="checkbox" name="confirm" value="yes" required /> Delete it from the pool
              </label>
              <button class="button quiet" type="submit">
                Delete coffee
              </button>
            </form>
            <p class="muted small">
              No bag is lost: each account's bags move to its own private copy, as when it makes the bean private.
            </p>
          </section>
        </div>
      </div>
      <section class="card table-card">
        <table class="library">
          <thead>
            <tr>
              <th>Date</th>
              <th>Field</th>
              <th>From</th>
              <th>To</th>
              <th>By</th>
              <th>
                <span class="visually-hidden">Undo</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {log.length === 0 && (
              <tr>
                <td colspan={6} class="muted">
                  No edits yet.
                </td>
              </tr>
            )}
            {log.map((edit) => (
              <tr>
                <td>{longDate(edit.editedOn)}</td>
                <td>{fieldLabels[edit.field] ?? edit.field}</td>
                <td class="muted">{shown(edit.oldValue)}</td>
                <td>{shown(edit.newValue)}</td>
                <td class="muted">{edit.editor === null ? 'deleted account' : <code>{edit.editor}</code>}</td>
                <td>
                  <form method="post" action={`/admin/edits/${edit.editId}/undo`}>
                    <input type="hidden" name="coffee" value={String(coffee.coffeeId)} />
                    <button class="button quiet" type="submit">
                      Undo
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p class="muted small">Undoing a rename is refused when another pool coffee has taken the old name since.</p>
    </AdminPage>,
    status,
  );
}
