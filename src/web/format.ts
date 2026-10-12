import type { Phase } from '../bag/library.js';

/** Calendar dates as YYYY-MM-DD, worked out in UTC so no time zone or DST shift moves a day. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`));

/** "25 Sep" */
export const shortDate = (date: string) => format(date, { day: 'numeric', month: 'short' });
/** "12 Oct 2026" */
export const fullDate = (date: string) => format(date, { day: 'numeric', month: 'short', year: 'numeric' });
/** "Fri 9 Oct" */
export const weekdayDate = (date: string) => format(date, { weekday: 'short', day: 'numeric', month: 'short' });
/** "Wednesday 7 October" */
export const longDate = (date: string) => format(date, { weekday: 'long', day: 'numeric', month: 'long' });
/** "18 October" */
export const dayMonth = (date: string) => format(date, { day: 'numeric', month: 'long' });

/** A day of the plan, as "+19"; day 0 is "day 0". */
export const dayLabel = (day: number) => (day === 0 ? 'day 0' : `${day > 0 ? '+' : ''}${day}`);

/** A window of plan days, as "+28 to +30", or "+12" when it is one day. */
export const dayRange = (window: { from: number; to: number }) =>
  window.from === window.to ? dayLabel(window.from) : `${dayLabel(window.from)} to ${dayLabel(window.to)}`;

/** "16 to 18 Oct", or "30 Oct to 2 Nov" across months. */
export function dateRange(roastDate: string, from: number, to: number): string {
  const start = addDays(roastDate, from);
  const end = addDays(roastDate, to);
  if (start === end) return shortDate(start);
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${format(start, { day: 'numeric' })} to ${shortDate(end)}`
    : `${shortDate(start)} to ${shortDate(end)}`;
}

export const phaseLabels: Record<Phase, string> = {
  resting: 'Resting',
  rested: 'Rested',
  peak: 'In peak',
  past: 'Past peak',
  no_roast_date: 'No roast date',
  no_plan: 'No plan',
};

export const processLabel = (process: string) => process.charAt(0).toUpperCase() + process.slice(1);

/** "Kenya, Nyeri" */
export const origin = (country: string | null, region: string | null) =>
  [country, region].filter((part) => part !== null && part !== '').join(', ');
