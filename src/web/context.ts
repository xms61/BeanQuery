import type { DatabaseSync } from 'node:sqlite';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { RateLimiter } from './rate-limit.js';

export interface WebConfig {
  db: DatabaseSync;
  now: () => Date;
  /** False only for local development over plain HTTP; the session cookie is then not marked `Secure`. */
  secureCookies: boolean;
  /** Who is asking, for the rate limits: the client address, kept in memory only. */
  clientKey: (c: Context) => string;
  /** The public origin forms must come from, such as `https://beans.example`. Defaults to the request's own. */
  origin?: string;
}

export interface Limits {
  signIn: RateLimiter;
  redeem: RateLimiter;
}

/** What every request carries: the config, the rate limits, and the signed-in account, if any. */
export interface Env {
  Variables: { accountId: number | null; admin: boolean; config: WebConfig; limits: Limits };
}

export const SESSION_DAYS = 90;

/** The session cookie's name. The `__Host-` prefix pins a secure cookie to this host and path. */
export function sessionCookieName(config: Pick<WebConfig, 'secureCookies'>): string {
  return config.secureCookies ? '__Host-session' : 'session';
}

/** Sets the session cookie, for a new session or to renew one on use. */
export function setSessionCookie(c: Context<Env>, token: string): void {
  const config = c.get('config');
  setCookie(c, sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** The signed-in account, or a redirect to the sign-in page. */
export function requireAccount(c: Context<Env>): number | Response {
  const accountId = c.get('accountId');
  return accountId === null ? c.redirect('/sign-in', 303) : accountId;
}

/**
 * Who is asking, for the rate limits. Behind the reverse proxy on the same host every connection comes from
 * localhost, so with `trustProxy` the client is the last address the proxy appended to `X-Forwarded-For`. Without
 * it the header is ignored, since a client can send any value.
 */
export function clientKeyFrom(trustProxy: boolean): (c: Context) => string {
  return (c) => {
    const forwarded = trustProxy ? c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() : undefined;
    return forwarded || getConnInfo(c).remote.address || 'unknown';
  };
}
