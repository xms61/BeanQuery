import { Hono } from 'hono';
import { accountSummary } from '../../account/account.js';
import { type Env, requireAccount } from '../context.js';
import { AppPage, CardPage } from '../layout.js';

/** The library, until its own change builds it out, and the Impressum. */
export const pageRoutes = new Hono<Env>();

pageRoutes.get('/', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const { bags } = accountSummary(c.var.config.db, accountId);
  return c.html(
    <AppPage title="Library" section="library" admin={c.var.admin}>
      <div class="page-head">
        <h1>Library</h1>
        <span class="muted">{bags === 1 ? '1 bag' : `${bags} bags`}</span>
      </div>
    </AppPage>,
  );
});

pageRoutes.get('/impressum', (c) => {
  const content = <Impressum />;
  if (c.var.accountId === null) return c.html(<CardPage title="Impressum">{content}</CardPage>);
  return c.html(
    <AppPage title="Impressum" section="impressum" admin={c.var.admin}>
      <section class="card">{content}</section>
    </AppPage>,
  );
});

function Impressum() {
  return (
    <>
      <h1>Impressum</h1>
      <p>BeanQuery is a private, non-commercial coffee log for a few friends, by invitation only.</p>
      <table class="rows">
        <tbody>
          <tr>
            <th>Responsible</th>
            <td>your friendly neighborhood brewer</td>
          </tr>
          <tr>
            <th>Contact</th>
            <td>the friend who sent you the invite</td>
          </tr>
          <tr>
            <th>Roasters</th>
            <td>names and slugs from every.coffee, fetched weekly for non-commercial use</td>
          </tr>
          <tr>
            <th>Privacy</th>
            <td>no tracking, no ads, no third-party scripts or fonts; logs keep no IP addresses</td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">Brewed with care, served without cookies, except the one that keeps you signed in.</p>
    </>
  );
}
