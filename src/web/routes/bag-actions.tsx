import { type Context, Hono } from 'hono';
import { deleteBag } from '../../bag/manage.js';
import { makeBeanPrivate, publishBean } from '../../coffee/privacy.js';
import { type Env, requireAccount } from '../context.js';
import { AppPage } from '../layout.js';
import { Differences } from './add.js';

/** Deleting a bag, and making its bean private or publishing it to the pool. */
export const bagActionRoutes = new Hono<Env>();

bagActionRoutes.post('/bags/:id/delete', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const body = await c.req.parseBody();
  if (body.confirm !== 'yes') return c.text('Tick the box to confirm.', 400);
  if (!deleteBag(c.var.config.db, accountId, bagIdOf(c))) return c.notFound();
  return c.redirect('/', 303);
});

bagActionRoutes.post('/bags/:id/private', (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const bagId = bagIdOf(c);
  const result = makeBeanPrivate(c.var.config.db, accountId, bagId);
  if (result.status === 'not_found') return c.notFound();
  return c.redirect(`/bags/${bagId}`, 303);
});

bagActionRoutes.post('/bags/:id/publish', async (c) => {
  const accountId = requireAccount(c);
  if (accountId instanceof Response) return accountId;
  const bagId = bagIdOf(c);
  const body = await c.req.parseBody();
  const choice =
    body.coffee === 'new'
      ? 'new'
      : typeof body.coffee === 'string' && /^[1-9]\d{0,15}$/.test(body.coffee)
        ? Number(body.coffee)
        : undefined;
  const result = publishBean(c.var.config.db, accountId, bagId, choice === undefined ? {} : { coffeeChoice: choice });
  if (result.status === 'not_found') return c.notFound();
  if (result.status === 'needs_coffee') {
    const question = result.bags[0];
    return c.html(
      <AppPage title="Publish" section="library" admin={c.var.admin}>
        <h1>Publish to the pool</h1>
        <form method="post" action={`/bags/${bagId}/publish`} class="card">
          <fieldset class="question">
            <legend>Is “{question?.entered}” one of these pool coffees?</legend>
            {question?.candidates.map((coffee) => (
              <label class="choice">
                <input type="radio" name="coffee" value={String(coffee.id)} required />
                <strong>{coffee.name}</strong>
              </label>
            ))}
            <label class="choice">
              <input type="radio" name="coffee" value="new" required />
              <strong>A new pool coffee</strong>
            </label>
          </fieldset>
          <button class="button" type="submit">
            Publish
          </button>
        </form>
      </AppPage>,
    );
  }
  if (result.status === 'saved' && result.differences.length > 0) {
    return c.html(
      <AppPage title="Published" section="library" admin={c.var.admin}>
        <h1>Published</h1>
        <Differences c={c} accountId={accountId} bagIds={[bagId]} differences={result.differences} />
        <a class="button" href={`/bags/${bagId}`}>
          Back to the bag
        </a>
      </AppPage>,
    );
  }
  return c.redirect(`/bags/${bagId}`, 303);
});

function bagIdOf(c: Context<Env>): number {
  const id = c.req.param('id') ?? '';
  return /^[1-9]\d{0,15}$/.test(id) ? Number(id) : 0;
}
