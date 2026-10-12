import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { createInvite } from '../account/account.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { createApp } from './app.js';

/** Shared by the web layer's route tests: an app on an in-memory database, a fixed clock and request helpers. */
export const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);
export const numberPattern = /[0-9A-Z]{4}( [0-9A-Z]{4}){4}/;

export function setup(options: { secureCookies?: boolean; defaultTimeZone?: string } = {}) {
  const db: DatabaseSync = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  const clock = { now: new Date('2026-10-12T12:00:00Z') };
  const app = createApp({
    db,
    now: () => clock.now,
    defaultTimeZone: options.defaultTimeZone ?? 'UTC',
    secureCookies: options.secureCookies ?? true,
    clientKey: (c) => c.req.header('x-test-client') ?? 'client-a',
  });
  const request = (
    path: string,
    init: {
      form?: Record<string, string>;
      multipart?: FormData;
      cookie?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const body = init.multipart ?? (init.form === undefined ? undefined : new URLSearchParams(init.form));
    return app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body }),
      headers: {
        Origin: 'http://localhost',
        ...(init.form === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
        ...(init.cookie === undefined ? {} : { Cookie: init.cookie }),
        ...init.headers,
      },
    });
  };
  return { app, db, clock, request };
}

/** The `name=value` pair of the session cookie a response sets, or undefined. */
export function sessionCookie(response: Response): string | undefined {
  return /((?:__Host-)?session=[^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
}

/** A new account through the redeem page: its number and session cookie. */
export async function redeemed(request: ReturnType<typeof setup>['request'], db: DatabaseSync) {
  const { code } = createInvite(db, new Date('2026-10-12T12:00:00Z'));
  const response = await request('/redeem', { form: { code } });
  const number = numberPattern.exec(await response.text())?.[0] as string;
  const accountId = Number(db.prepare('SELECT max(id) AS id FROM account').get()?.id);
  return { number, cookie: sessionCookie(response) as string, accountId };
}
