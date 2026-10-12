import type { DatabaseSync } from 'node:sqlite';

export interface Reminder {
  bagId: number;
  roaster: string;
  coffee: string;
  /** `portion`: open, portion and freeze. `mid_peak`: the mid-peak check. */
  event: 'portion' | 'mid_peak';
  dueOn: string;
}

const comingUpDays = 10;
const midPeakShownDays = 3;

/**
 * The toasts due on `today` and the events of the next 10 days, for one account's bags that have a roast date and a
 * plan and are not finished. `today` is the user's local date, as YYYY-MM-DD.
 * - A portion is due from its day until the bag is open, frozen or finished, or the peak has ended.
 * - A mid-peak check is due from its day until the user dismisses it, or for 3 days.
 */
export function reminders(
  db: DatabaseSync,
  accountId: number,
  today: string,
): { due: Reminder[]; comingUp: Reminder[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || addDays(today, 0) !== today) {
    throw new Error(`today must be a date as YYYY-MM-DD, not ${today}`);
  }
  const horizon = addDays(today, comingUpDays);
  const rows = db
    .prepare(
      `SELECT b.id, b.roast_date, b.portion_from, b.peak_to, b.mid_peak, b.mid_peak_dismissed, b.state,
         r.name AS roaster, c.name AS coffee
       FROM bag b JOIN coffee c ON c.id = b.coffee_id JOIN roaster r ON r.id = c.roaster_id
       WHERE b.account_id = ? AND b.roast_date IS NOT NULL AND b.portion_from IS NOT NULL AND b.state != 'finished'
       ORDER BY b.id`,
    )
    .all(accountId);

  const due: Reminder[] = [];
  const comingUp: Reminder[] = [];
  for (const row of rows) {
    const roastDate = String(row.roast_date);
    const base = { bagId: Number(row.id), roaster: String(row.roaster), coffee: String(row.coffee) };
    const portion = { ...base, event: 'portion' as const, dueOn: addDays(roastDate, Number(row.portion_from)) };
    const midPeak = { ...base, event: 'mid_peak' as const, dueOn: addDays(roastDate, Number(row.mid_peak)) };

    if (row.state === 'sealed') {
      const peakEnds = addDays(roastDate, Number(row.peak_to));
      if (portion.dueOn <= today && today <= peakEnds) due.push(portion);
      else if (today < portion.dueOn && portion.dueOn <= horizon) comingUp.push(portion);
    }
    if (row.mid_peak_dismissed === 0) {
      if (midPeak.dueOn <= today && today < addDays(midPeak.dueOn, midPeakShownDays)) due.push(midPeak);
      else if (today < midPeak.dueOn && midPeak.dueOn <= horizon) comingUp.push(midPeak);
    }
  }
  const byDate = (a: Reminder, b: Reminder) => a.dueOn.localeCompare(b.dueOn) || a.bagId - b.bagId;
  return { due: due.sort(byDate), comingUp: comingUp.sort(byDate) };
}

/** Dismisses an own bag's mid-peak toast. False when the account has no such bag. */
export function dismissMidPeak(db: DatabaseSync, accountId: number, bagId: number): boolean {
  return (
    db.prepare('UPDATE bag SET mid_peak_dismissed = 1 WHERE id = ? AND account_id = ?').run(bagId, accountId)
      .changes === 1
  );
}

/** Calendar arithmetic on YYYY-MM-DD dates, in UTC so no time zone or DST shift can move a day. */
function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(time) ? '' : new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}
