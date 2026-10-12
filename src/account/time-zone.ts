import type { DatabaseSync } from 'node:sqlite';

/**
 * Each account's time zone, so "today" is the user's day: phases, plan dates and reminders change at their midnight.
 * The browser reports it when signing in; the account page can change it. No cookie carries it.
 */
export function isTimeZone(value: string): boolean {
  if (value === '' || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The date at `now` in a time zone, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Sets an account's time zone. False, and nothing changed, for a name that is not a time zone. */
export function setTimeZone(db: DatabaseSync, accountId: number, timeZone: string): boolean {
  if (!isTimeZone(timeZone)) return false;
  return db.prepare('UPDATE account SET time_zone = ? WHERE id = ?').run(timeZone, accountId).changes === 1;
}

/** An account's time zone, or `fallback` (the server's default) when it has none. */
export function timeZoneOf(db: DatabaseSync, accountId: number, fallback: string): string {
  const zone = db.prepare('SELECT time_zone FROM account WHERE id = ?').get(accountId)?.time_zone;
  return typeof zone === 'string' && isTimeZone(zone) ? zone : fallback;
}
