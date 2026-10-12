import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { pasteLimits } from '../contract/bag-json.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import { importBags } from './import.js';
import { setBagState } from './manage.js';
import { dismissMidPeak, reminders } from './reminders.js';

const fixture = readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8');

/**
 * The five real bags in account 1. Their dates, from roast date plus offsets:
 * bag 1 portion 2026-09-30, mid-peak 2026-10-09, peak ends 2026-10-18;
 * bag 2 portion 2026-10-01, mid-peak 2026-10-10, peak ends 2026-10-19;
 * bag 3 portion 2026-10-13, mid-peak 2026-10-30; bag 4 portion 2026-10-23; bag 5 portion 2026-10-24.
 */
function seeded(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  importRoasters(db, [
    { slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] },
    { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
  ]);
  db.exec(`INSERT INTO account (id, key_hash, created_on, last_seen_on) VALUES
    (1, randomblob(32), '2026-10-12', '2026-10-12'), (2, randomblob(32), '2026-10-12', '2026-10-12')`);
  importBags(db, 1, fixture, { limits: pasteLimits });
  return db;
}

const events = (list: { bagId: number; event: string; dueOn: string }[]) =>
  list.map(({ bagId, event, dueOn }) => `${bagId} ${event} ${dueOn}`);

describe('reminders', () => {
  test('on 2026-10-12: two portions due, one mid-peak due, and bag 3’s portion coming up', () => {
    const db = seeded();
    const result = reminders(db, 1, '2026-10-12');

    expect(events(result.due)).toEqual(['1 portion 2026-09-30', '2 portion 2026-10-01', '2 mid_peak 2026-10-10']);
    expect(events(result.comingUp)).toEqual(['3 portion 2026-10-13']);
    expect(result.due[0]).toMatchObject({ roaster: 'Nord Kaffe', coffee: 'Ethiopia Sasaba' });
    db.close();
  });

  test('a portion is due from its day, and shows until the peak ends', () => {
    const db = seeded();
    expect(events(reminders(db, 1, '2026-09-29').due)).toEqual([]);
    expect(events(reminders(db, 1, '2026-09-30').due)).toEqual(['1 portion 2026-09-30']);
    expect(events(reminders(db, 1, '2026-10-18').due)).toContain('1 portion 2026-09-30');
    expect(events(reminders(db, 1, '2026-10-19').due)).not.toContain('1 portion 2026-09-30');
    db.close();
  });

  test('a portion clears once the bag is open, frozen or finished', () => {
    const db = seeded();
    for (const state of ['open', 'frozen', 'finished'] as const) {
      setBagState(db, 1, 1, 'sealed', '2026-10-12');
      setBagState(db, 1, 1, state, '2026-10-12');
      expect(events(reminders(db, 1, '2026-10-01').due)).not.toContain('1 portion 2026-09-30');
    }
    db.close();
  });

  test('a mid-peak check shows on its day and the two after, until three days have passed', () => {
    const db = seeded();
    setBagState(db, 1, 1, 'frozen', '2026-10-12');
    expect(events(reminders(db, 1, '2026-10-08').due)).not.toContain('1 mid_peak 2026-10-09');
    expect(events(reminders(db, 1, '2026-10-09').due)).toContain('1 mid_peak 2026-10-09');
    expect(events(reminders(db, 1, '2026-10-11').due)).toContain('1 mid_peak 2026-10-09');
    expect(events(reminders(db, 1, '2026-10-12').due)).not.toContain('1 mid_peak 2026-10-09');
    db.close();
  });

  test('a dismissed mid-peak check clears, for that bag only', () => {
    const db = seeded();
    expect(dismissMidPeak(db, 1, 2)).toBe(true);
    expect(events(reminders(db, 1, '2026-10-12').due)).toEqual(['1 portion 2026-09-30', '2 portion 2026-10-01']);
    db.close();
  });

  test('a finished bag gets no reminders at all, and neither does one without a roast date or a plan', () => {
    const db = seeded();
    setBagState(db, 1, 2, 'finished', '2026-10-12');
    db.exec("UPDATE bag SET roast_date = NULL, roast_date_status = 'ambiguous' WHERE id = 1");
    db.exec(`UPDATE bag SET rest_from = NULL, rest_to = NULL, peak_from = NULL, peak_to = NULL, portion_from = NULL,
      portion_to = NULL, mid_peak = NULL, tube_count = NULL, dial_in_g = NULL WHERE id = 3`);
    const result = reminders(db, 1, '2026-10-12');
    expect([...events(result.due), ...events(result.comingUp)]).toEqual([]);
    db.close();
  });

  test('the coming-up list covers the next 10 days, not today', () => {
    const db = seeded();
    expect(events(reminders(db, 1, '2026-10-03').comingUp)).toEqual([
      '1 mid_peak 2026-10-09',
      '2 mid_peak 2026-10-10',
      '3 portion 2026-10-13',
    ]);
    expect(events(reminders(db, 1, '2026-10-02').comingUp)).toEqual(['1 mid_peak 2026-10-09', '2 mid_peak 2026-10-10']);
    db.close();
  });

  test("never shows or dismisses another account's bags", () => {
    const db = seeded();
    expect(reminders(db, 2, '2026-10-12')).toEqual({ due: [], comingUp: [] });
    expect(dismissMidPeak(db, 2, 2)).toBe(false);
    expect(events(reminders(db, 1, '2026-10-12').due)).toContain('2 mid_peak 2026-10-10');
    db.close();
  });

  test('refuses a today that is not a date', () => {
    const db = seeded();
    expect(() => reminders(db, 1, '12 Oct 2026')).toThrow(/YYYY-MM-DD/);
    db.close();
  });
});
