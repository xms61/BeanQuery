import { describe, expect, test } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { isTimeZone, localDate, setTimeZone, timeZoneOf } from './time-zone.js';

describe('time zones', () => {
  test('the local date follows the zone across midnight', () => {
    const lateEvening = new Date('2026-10-12T22:30:00Z');
    expect(localDate(lateEvening, 'UTC')).toBe('2026-10-12');
    expect(localDate(lateEvening, 'Europe/Berlin')).toBe('2026-10-13');
    expect(localDate(lateEvening, 'America/Los_Angeles')).toBe('2026-10-12');
  });

  test('only IANA zone names count', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('x'.repeat(200))).toBe(false);
  });

  test('an account keeps its zone, and falls back to the server default without one', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
      (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);

    expect(timeZoneOf(db, 1, 'UTC')).toBe('UTC');
    expect(setTimeZone(db, 1, 'Europe/Berlin')).toBe(true);
    expect(timeZoneOf(db, 1, 'UTC')).toBe('Europe/Berlin');
    expect(timeZoneOf(db, 2, 'UTC')).toBe('UTC');
    expect(setTimeZone(db, 1, 'Mars/Olympus')).toBe(false);
    expect(timeZoneOf(db, 1, 'UTC')).toBe('Europe/Berlin');
    expect(() => db.exec("UPDATE account SET time_zone = '' WHERE id = 2")).toThrow(/CHECK/);
    db.close();
  });
});
