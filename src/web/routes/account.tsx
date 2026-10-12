import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import {
  accountSummary,
  deleteAccount,
  redeemInvite,
  signIn,
  signOut,
  signOutEverywhere,
} from '../../account/account.js';
import { setTimeZone, timeZoneOf } from '../../account/time-zone.js';
import { exportCsv } from '../../bag/csv.js';
import { exportBags } from '../../bag/export.js';
import { type Env, requireAccount, SESSION_DAYS, sessionCookieName, setSessionCookie } from '../context.js';
import { AppPage, CardPage } from '../layout.js';

/** Redeeming an invite, signing in and out, and the account page with export and delete. */
export const accountRoutes = new Hono<Env>();

accountRoutes.get('/redeem', (c) => {
  if (c.get('accountId') !== null) return c.redirect('/', 303);
  return c.html(<RedeemPage />);
});

accountRoutes.post('/redeem', async (c) => {
  const { config, limits } = c.var;
  if (!limits.redeem.attempt(config.clientKey(c), config.now())) return tooMany(c);
  const code = await field(c, 'code');
  const redeemed = redeemInvite(config.db, code, config.now());
  if (redeemed.status !== 'redeemed') {
    return c.html(<RedeemPage code={code} error="That invite code is unknown, used or expired." />, 400);
  }
  const session = signIn(config.db, redeemed.accountNumber, config.now());
  if (session.status !== 'signed_in') throw new Error('A new account could not sign in');
  rememberTimeZone(config.db, session.accountId, await field(c, 'time_zone'));
  setSessionCookie(c, session.token);
  // Shown in this response only, never redirected to, so the number is in no URL, history entry or cache.
  return c.html(<AccountNumberPage accountNumber={redeemed.accountNumber} />);
});

accountRoutes.post('/welcome', (c) => c.redirect('/', 303));

accountRoutes.get('/sign-in', (c) => {
  if (c.get('accountId') !== null) return c.redirect('/', 303);
  return c.html(<SignInPage />);
});

accountRoutes.post('/sign-in', async (c) => {
  const { config, limits } = c.var;
  if (!limits.signIn.attempt(config.clientKey(c), config.now())) return tooMany(c);
  const session = signIn(config.db, await field(c, 'account_number'), config.now());
  if (session.status !== 'signed_in') {
    return c.html(<SignInPage error="No account has that number. Check it and try again." />, 400);
  }
  rememberTimeZone(config.db, session.accountId, await field(c, 'time_zone'));
  setSessionCookie(c, session.token);
  return c.redirect('/', 303);
});

accountRoutes.post('/sign-out', (c) => {
  const { config } = c.var;
  const token = getCookie(c, sessionCookieName(config));
  if (token !== undefined) signOut(config.db, token);
  deleteCookie(c, sessionCookieName(config), { path: '/', secure: config.secureCookies });
  return c.redirect('/sign-in', 303);
});

accountRoutes.get('/account', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const { config } = c.var;
  const summary = accountSummary(config.db, accountId);
  return c.html(
    <AccountPage
      admin={c.var.admin}
      bags={summary.bags}
      privateBags={summary.privateBags}
      timeZone={timeZoneOf(config.db, accountId, config.defaultTimeZone)}
    />,
  );
});

accountRoutes.post('/account/time-zone', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  if (!setTimeZone(c.var.config.db, accountId, await field(c, 'time_zone'))) return c.text('Not a time zone', 400);
  return c.redirect('/account', 303);
});

accountRoutes.get('/account/export.json', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const { config } = c.var;
  const day = config.now().toISOString().slice(0, 10);
  return c.body(`${JSON.stringify(exportBags(config.db, accountId), null, 2)}\n`, 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="beanquery-bags-${day}.json"`,
  });
});

accountRoutes.get('/account/export.csv', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const { config } = c.var;
  const day = config.now().toISOString().slice(0, 10);
  return c.body(exportCsv(config.db, accountId), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="beanquery-bags-${day}.csv"`,
  });
});

accountRoutes.post('/account/sign-out-everywhere', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const { config } = c.var;
  signOutEverywhere(config.db, accountId);
  deleteCookie(c, sessionCookieName(config), { path: '/', secure: config.secureCookies });
  return c.redirect('/sign-in', 303);
});

accountRoutes.get('/account/delete', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  return c.html(<DeletePage />);
});

accountRoutes.post('/account/delete', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const { config } = c.var;
  if ((await field(c, 'confirm')) !== 'yes') return c.html(<DeletePage error="Tick the box to confirm." />, 400);
  deleteAccount(config.db, accountId);
  deleteCookie(c, sessionCookieName(config), { path: '/', secure: config.secureCookies });
  return c.html(
    <CardPage title="Account deleted">
      <h1>Account deleted</h1>
      <p class="muted">Every bag and private coffee of the account is gone. Thanks for the coffee talk.</p>
    </CardPage>,
  );
});

/** Keeps the time zone the browser reported, if it is one; the account page can change it later. */
function rememberTimeZone(db: Env['Variables']['config']['db'], accountId: number, timeZone: string): void {
  if (timeZone !== '') setTimeZone(db, accountId, timeZone);
}

/** One text field of a posted form, or an empty string. */
async function field(c: Context<Env>, name: string): Promise<string> {
  const value = (await c.req.parseBody())[name];
  return typeof value === 'string' ? value : '';
}

function tooMany(c: Context<Env>) {
  return c.html(
    <CardPage title="Too many attempts">
      <h1>Too many attempts</h1>
      <p class="muted">Wait a little, then try again.</p>
    </CardPage>,
    429,
  );
}

function RedeemPage(props: { code?: string; error?: string }) {
  return (
    <CardPage title="Redeem an invite">
      <div class="brand-line">BeanQuery</div>
      <h1>Redeem an invite</h1>
      <form method="post" action="/redeem">
        <label class="field">
          Invite code
          <input name="code" value={props.code ?? ''} autocomplete="off" spellcheck={false} required />
        </label>
        <input type="hidden" name="time_zone" data-time-zone />
        {props.error && <p class="error">{props.error}</p>}
        <p class="muted small">
          You get an account number, nothing else: no name, email or password. The friend who invited you never sees it.
        </p>
        <button class="button" type="submit">
          Redeem
        </button>
      </form>
      <p class="muted small">
        Have an account? <a href="/sign-in">Sign in</a>
      </p>
    </CardPage>
  );
}

function AccountNumberPage(props: { accountNumber: string }) {
  const file = `data:text/plain;charset=utf-8,${encodeURIComponent(`BeanQuery account number\n${props.accountNumber}\n`)}`;
  return (
    <CardPage title="Your account number" wide>
      <h1>Your account number</h1>
      <p class="muted">
        This is the only key to your account, and it is shown only now. Nobody can recover it, not even the admin.
      </p>
      <div class="secret">{props.accountNumber}</div>
      <div class="actions">
        <button class="button secondary" type="button" data-copy={props.accountNumber} hidden>
          Copy
        </button>
        <a class="button secondary" href={file} download="beanquery-account-number.txt">
          Download as a file
        </a>
        <button class="button secondary" type="button" data-print hidden>
          Print
        </button>
      </div>
      <div class="note">
        <strong>Keep it like a key</strong>
        <p class="muted small">Lost it? Ask for a new invite, then import your last export into the new account.</p>
      </div>
      <form method="post" action="/welcome" class="no-print">
        <label class="check">
          <input type="checkbox" name="saved" value="yes" required /> I saved my account number
        </label>
        <button class="button" type="submit">
          Continue to my library
        </button>
      </form>
    </CardPage>
  );
}

function SignInPage(props: { error?: string }) {
  return (
    <CardPage title="Sign in">
      <div class="brand-line">BeanQuery</div>
      <h1>Sign in</h1>
      <form method="post" action="/sign-in">
        <label class="field">
          Account number
          <input name="account_number" autocomplete="off" spellcheck={false} required />
        </label>
        <input type="hidden" name="time_zone" data-time-zone />
        {props.error && <p class="error">{props.error}</p>}
        <p class="muted small">
          Spaces, dashes and case don't matter. You stay signed in for {SESSION_DAYS} days on this browser.
        </p>
        <button class="button" type="submit">
          Sign in
        </button>
      </form>
      <p class="muted small">
        Lost your number? Ask the friend who invited you for a new invite, and import your last export. Got an invite?{' '}
        <a href="/redeem">Redeem it</a>
      </p>
    </CardPage>
  );
}

function AccountPage(props: { admin: boolean; bags: number; privateBags: number; timeZone: string }) {
  const bags =
    props.bags === 0
      ? 'none yet'
      : `${props.bags}${props.privateBags > 0 ? `, ${props.privateBags === props.bags ? 'all' : props.privateBags} of them private` : ''}`;
  return (
    <AppPage title="Account" section="account" admin={props.admin}>
      <div class="page-head">
        <h1>Account</h1>
        <span class="muted">anonymous, by invitation</span>
      </div>
      <div class="grid">
        <div class="stack">
          <section class="card">
            <h2>Export and import</h2>
            <p class="muted small">
              Your export is your only backup: every bag with your plan, brew, rating and notes, private beans included.
              The JSON imports back into any account; the CSV, one row per bag, is for a spreadsheet.
            </p>
            <div class="actions">
              <a class="button" href="/account/export.json">
                Download JSON
              </a>
              <a class="button secondary" href="/account/export.csv">
                Download CSV
              </a>
            </div>
            <form method="post" action="/import" enctype="multipart/form-data" class="actions">
              <label class="field">
                Import an export
                <input type="file" name="file" accept="application/json,.json" required />
              </label>
              <button class="button secondary" type="submit">
                Import
              </button>
            </form>
            <table class="rows">
              <tbody>
                <tr>
                  <th>Your bags</th>
                  <td>{bags}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section class="card">
            <h2>Time zone</h2>
            <p class="muted small">
              Plan dates, phases and reminders change at midnight here. Your browser sets it when you sign in.
            </p>
            <form method="post" action="/account/time-zone" class="actions">
              <label class="filter">
                <span class="visually-hidden">Time zone</span>
                <select name="time_zone">
                  {timeZones(props.timeZone).map((zone) => (
                    <option value={zone} selected={zone === props.timeZone}>
                      {zone.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <button class="button secondary" type="submit">
                Save
              </button>
            </form>
          </section>
          <section class="card">
            <h2>Signed in</h2>
            <p class="muted small">
              This browser stays signed in for {SESSION_DAYS} days, renewed each time you use it.
            </p>
            <div class="actions">
              <form method="post" action="/sign-out" class="inline">
                <button class="button secondary" type="submit">
                  Sign out
                </button>
              </form>
              <form method="post" action="/account/sign-out-everywhere" class="inline">
                <button class="button secondary" type="submit">
                  Sign out everywhere
                </button>
              </form>
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="card quiet">
            <h2>What others see</h2>
            <p class="muted small">
              Other accounts see the bean facts of your published beans and a collective rating that carries no account.
              Never your plan, water, grind, notes or prices. The admin runs the server and could read the database.
            </p>
          </section>
          <section class="card">
            <h2>Delete account</h2>
            <p class="muted small">
              Removes every bag, private coffee, grinder, note and session of this account. Pool coffees and your edits
              to them stay, without your account. Export first if you want to keep anything.
            </p>
            <a class="button quiet" href="/account/delete">
              Delete my account
            </a>
          </section>
        </div>
      </div>
    </AppPage>
  );
}

function DeletePage(props: { error?: string }) {
  return (
    <CardPage title="Delete account">
      <h1>Delete your account?</h1>
      <p class="muted">
        Every bag, private coffee, grinder, note and session of this account is removed, and can't be brought back.
        Export first if you want to keep anything.
      </p>
      <form method="post" action="/account/delete">
        <label class="check">
          <input type="checkbox" name="confirm" value="yes" required /> Delete my account and everything in it
        </label>
        {props.error && <p class="error">{props.error}</p>}
        <div class="actions">
          <button class="button danger" type="submit">
            Delete my account
          </button>
          <a class="button quiet" href="/account">
            Keep it
          </a>
        </div>
      </form>
    </CardPage>
  );
}

/** Every IANA time zone the runtime knows, with the current one first if the list lacks it (such as UTC). */
function timeZones(current: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes(current) ? zones : [current, ...zones];
}
