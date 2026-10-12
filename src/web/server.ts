import { serve } from '@hono/node-server';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { createApp } from './app.js';
import { clientKeyFrom } from './context.js';

// Settings come from the environment (.env.example lists them). The app logs no requests, so no address is written.
const path = process.env.BEANQUERY_DB;
if (path === undefined || path === '') {
  console.error('Set BEANQUERY_DB to the SQLite file, for example in .env.');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '127.0.0.1';

const db = openDatabase(path);
migrate(db);
const app = createApp({
  db,
  now: () => new Date(),
  secureCookies: process.env.SECURE_COOKIES !== 'false',
  ...(process.env.PUBLIC_ORIGIN ? { origin: process.env.PUBLIC_ORIGIN } : {}),
  clientKey: clientKeyFrom(process.env.TRUST_PROXY === 'true'),
});

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`BeanQuery listening on http://${hostname}:${info.port}`);
});
const stop = () => server.close(() => db.close());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
